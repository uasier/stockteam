from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Exists, OuterRef
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from . import market
from .models import Activity, Comment, CommentLike, Holding, RiskReport, Stock, StockLike, Tag, WatchItem
from .quotes import Headline, normalize_code
from .risk import build_report


def _money(value, label: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError(f"请填写{label}") from None
    if not number.is_finite() or number <= 0:
        raise ValidationError(f"{label}需要大于 0")
    return number.quantize(Decimal("0.001"))


def _note(value, limit: int = 200) -> str:
    return str(value or "").strip()[:limit]


def _day(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError("自选日期不正确") from None


def _codes(raw) -> list[str]:
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list):
        raise ValidationError("没有可刷新的股票")
    codes = []
    for item in raw:
        code = normalize_code(str(item))
        if code and code not in codes:
            codes.append(code)
    if not codes:
        raise ValidationError("没有可刷新的股票")
    if len(codes) > 80:
        raise ValidationError("一次最多刷新 80 只")
    return codes


def _liked(user):
    return Exists(StockLike.objects.filter(stock_id=OuterRef("stock_id"), user_id=user.id))


def watch_queryset(user):
    """小群共享的观察列表。liked 仍按当前查看者计算。"""
    return (
        WatchItem.objects.select_related("user", "stock")
        .annotate(attention=Count("stock__likes", distinct=True), liked=_liked(user))
        .prefetch_related("tags")
    )


def own_watch_queryset(user):
    return watch_queryset(user).filter(user=user)


def holding_queryset(user, status: str | None = None):
    query = Holding.objects.filter(user=user).select_related("user", "stock")
    if status in {Holding.OPEN, Holding.CLOSED}:
        query = query.filter(status=status)
    return query.annotate(attention=Count("stock__likes", distinct=True), liked=_liked(user))


def visible_holdings(user, status: str | None = None):
    """当前持仓对小群可见。已卖出仍只看本人。"""
    if status == Holding.CLOSED:
        scope = Holding.objects.filter(user=user, status=Holding.CLOSED)
    elif status == Holding.OPEN:
        scope = Holding.objects.filter(status=Holding.OPEN)
    else:
        scope = Holding.objects.filter(status=Holding.OPEN) | Holding.objects.filter(
            user=user, status=Holding.CLOSED
        )
    return scope.select_related("user", "stock").annotate(
        attention=Count("stock__likes", distinct=True),
        liked=_liked(user),
    )


def _activity_query(user):
    return Activity.objects.select_related("user", "stock").annotate(
        attention=Count("stock__likes", distinct=True),
        liked=_liked(user),
    )


def activity_queryset(user, kind: str | None = None):
    selected = str(kind or "").strip()
    query = _activity_query(user)
    if selected == "trade":
        query = query.filter(kind__in=[Activity.BUY, Activity.SELL])
    elif selected:
        allowed = {code for code, _label in Activity.KIND}
        if selected not in allowed:
            raise ValidationError("没有这种动态类型")
        query = query.filter(kind=selected)
    return query.order_by("-id")[:100]


def stock_timeline(user, raw_code: str):
    """只返回这只股票已发生的圈子事件，不顺手创建股票。新的在前。"""
    code = normalize_code(raw_code)
    if not code:
        raise ValidationError("请输入 6 位股票代码")
    stock = Stock.objects.filter(code=code).first()
    if stock is None:
        return []
    return _activity_query(user).filter(stock=stock).order_by("-created_at", "-id")[:300]


def comment_queryset(user, stock: Stock, *, limit: int | None = 100):
    query = (
        Comment.objects.filter(stock=stock)
        .select_related("user")
        .annotate(
            like_count=Count("likes", distinct=True),
            liked=Exists(CommentLike.objects.filter(comment_id=OuterRef("pk"), user_id=user.id)),
        )
        .order_by("-id")
    )
    return query[:limit] if limit else query


def search(keyword: str) -> list[dict]:
    """只查已经记在小群里的股票。实时名称、代码和拼音由设备自己检索。"""
    text = str(keyword or "").strip()
    if not text:
        return []
    if len(text) > 32:
        raise ValidationError("搜索词太长")
    code = normalize_code(text)
    rows = Stock.objects.filter(code__startswith=code) if code else Stock.objects.filter(name__icontains=text)
    return [{"code": item.code, "name": item.name, "market": ""} for item in rows.order_by("code")[:8]]


def load_quotes(raw, *, force: bool = False) -> list[Stock]:
    codes = _codes(raw)
    stocks = list(Stock.objects.filter(code__in=codes))
    order = {code: index for index, code in enumerate(codes)}
    stocks.sort(key=lambda item: order.get(item.code, 0))
    return stocks


def store_quotes(items) -> list[Stock]:
    if not isinstance(items, list):
        return []
    return market.store_quotes(items)


def _ensure_stock(raw: str) -> Stock:
    code = normalize_code(raw)
    if not code:
        raise ValidationError("请输入 6 位股票代码")
    stock = Stock.objects.filter(code=code).first()
    if stock:
        return stock
    return Stock.objects.create(code=code, name=code)


def add_watch(user, raw_code: str, *, source_id=None, name: str = "", price=None) -> WatchItem:
    stock = _ensure_stock(raw_code)
    if WatchItem.objects.filter(user=user, stock=stock).exists():
        raise ValidationError("这只股票已经在观察列表里")
    clean_name = str(name or "").strip()[:64]
    if clean_name:
        stock.name = clean_name
    if price not in (None, ""):
        try:
            stock.price = Decimal(str(price))
            stock.quoted_at = timezone.now()
        except (InvalidOperation, ValueError):
            pass
    if clean_name or stock.quoted_at:
        stock.save()
    source = _watch_source(user, stock, source_id)
    followed = source is not None or WatchItem.objects.filter(stock=stock).exists()
    item = WatchItem.objects.create(
        user=user,
        stock=stock,
        custom_price=None if followed else stock.price,
        custom_date=timezone.localdate(),
    )
    if followed and source is None:
        source = (
            Activity.objects.filter(stock=stock, kind=Activity.WATCH, source__isnull=True)
            .order_by("id")
            .first()
        )
    note = _watch_text(item)
    if followed:
        note = f"跟进观察 · {note}" if note else "跟进观察"
    _record(user, stock, Activity.WATCH, price=item.custom_price, note=note, source=source)
    return item


def update_watch(user, item_id: int, data: dict) -> WatchItem:
    item = own_watch_queryset(user).filter(pk=item_id).first()
    if item is None:
        raise NotFound("没有找到这条观察")
    fields = []
    if "custom_price" in data:
        item.custom_price = None if data["custom_price"] in (None, "") else _money(data["custom_price"], "自选价格")
        fields.append("custom_price")
    if "custom_date" in data:
        item.custom_date = _day(data["custom_date"])
        fields.append("custom_date")
    if "note" in data:
        item.note = _note(data["note"])
        fields.append("note")
    if fields:
        item.save(update_fields=fields)
    if "tag_names" in data:
        _set_tags(user, item, data["tag_names"])
    saved = own_watch_queryset(user).get(pk=item.id)
    if fields or "tag_names" in data:
        _record(user, saved.stock, Activity.WATCH_EDIT, price=saved.custom_price, note=_watch_text(saved))
    return saved


def remove_watch(user, item_id: int) -> None:
    item = WatchItem.objects.select_related("stock").filter(user=user, pk=item_id).first()
    if item is None:
        raise NotFound("没有找到这条观察")
    stock = item.stock
    item.delete()
    _record(user, stock, Activity.UNWATCH)


def _set_tags(user, item: WatchItem, names) -> None:
    if not isinstance(names, list):
        raise ValidationError("标签格式不正确")
    clean = []
    for name in names:
        text = str(name).strip()
        if not text:
            continue
        if len(text) > 8:
            raise ValidationError("标签最多 8 个字")
        if text not in clean:
            clean.append(text)
    if len(clean) > 6:
        raise ValidationError("最多 6 个标签")
    tags = []
    for name in clean:
        tag, _ = Tag.objects.get_or_create(user=user, name=name)
        tags.append(tag)
    item.tags.set(tags)


def _watch_source(user, stock, source_id):
    if not source_id:
        return None
    source = Activity.objects.filter(pk=source_id, kind=Activity.WATCH).first()
    if source is None:
        raise ValidationError("没有找到要跟随的观察")
    if source.user_id == user.id:
        raise ValidationError("不能跟随自己的操作")
    if source.stock_id != stock.id:
        raise ValidationError("跟进的不是同一只股票")
    return source


def _watch_text(item: WatchItem) -> str:
    parts = []
    if item.custom_price is not None:
        parts.append(f"自选价 {format(item.custom_price, 'f')}")
    if item.custom_date:
        parts.append(item.custom_date.isoformat())
    names = [tag.name for tag in item.tags.all()]
    if names:
        parts.append("、".join(names))
    if item.note:
        parts.append(item.note)
    return " · ".join(parts)[:500]


def _record(user, stock, kind: str, *, price=None, quantity=None, note: str = "", holding=None, source=None):
    return Activity.objects.create(
        user=user,
        stock=stock,
        holding=holding,
        source=source,
        kind=kind,
        price=price,
        quantity=quantity,
        note=_note(note, 500),
    )


def _source(source_id, kind: str, user):
    if not source_id:
        return None
    source = Activity.objects.filter(pk=source_id).first()
    if source is None:
        raise ValidationError("没有找到要跟随的操作")
    if source.user_id == user.id:
        raise ValidationError("不能跟随自己的操作")
    if source.kind != kind:
        raise ValidationError("跟随的操作类型不一致")
    return source


def open_holding(user, *, code: str, cost_price, note: str = "", source_id=None) -> Holding:
    stock = _ensure_stock(code)
    if Holding.objects.filter(user=user, stock=stock, status=Holding.OPEN).exists():
        raise ValidationError("你已经持有这只股票，可以在持仓里卖出")
    cost = _money(cost_price, "成本")
    source = _source(source_id, Activity.BUY, user)
    with transaction.atomic():
        holding = Holding.objects.create(
            user=user,
            stock=stock,
            cost_price=cost,
            note=_note(note),
        )
        _record(
            user,
            stock,
            Activity.BUY,
            price=cost,
            note=note,
            holding=holding,
            source=source,
        )
    return holding_queryset(user).get(pk=holding.id)


def sell_holding(user, holding_id: int, *, sell_price, note: str = "", source_id=None) -> Holding:
    source = _source(source_id, Activity.SELL, user)
    price = _money(sell_price, "卖出价格")
    with transaction.atomic():
        holding = Holding.objects.select_for_update().filter(pk=holding_id, user=user).first()
        if holding is None:
            raise NotFound("没有找到这笔持仓")
        if holding.status != Holding.OPEN:
            raise ValidationError("这笔持仓已经卖出")
        if source and source.stock_id != holding.stock_id:
            raise ValidationError("跟卖的不是同一只股票")
        holding.status = Holding.CLOSED
        holding.sell_price = price
        holding.closed_at = timezone.now()
        if note:
            holding.note = _note(note)
        holding.save(update_fields=["status", "sell_price", "closed_at", "note"])
        _record(
            user,
            holding.stock,
            Activity.SELL,
            price=price,
            note=note,
            holding=holding,
            source=source,
        )
    return holding_queryset(user).get(pk=holding.id)


def follow_activity(user, activity_id: int, *, price, note: str = ""):
    source = Activity.objects.select_related("stock").filter(pk=activity_id).first()
    if source is None:
        raise NotFound("没有找到要跟随的操作")
    if source.user_id == user.id:
        raise ValidationError("不能跟随自己的操作")
    if source.kind == Activity.WATCH:
        return {"kind": Activity.WATCH, "watch": add_watch(user, source.stock.code, source_id=source.id)}
    if source.kind not in Activity.TRADABLE:
        raise ValidationError("这条动态不能跟随")
    if source.kind == Activity.BUY:
        return {
            "kind": "buy",
            "holding": open_holding(
                user,
                code=source.stock.code,
                cost_price=price if price not in (None, "") else source.price,
                note=note,
                source_id=source.id,
            ),
        }
    holding = Holding.objects.filter(user=user, stock=source.stock, status=Holding.OPEN).first()
    if holding is None:
        raise ValidationError("你还没有持有这只股票，不能跟卖")
    return {
        "kind": "sell",
        "holding": sell_holding(
            user,
            holding.id,
            sell_price=price if price not in (None, "") else source.price,
            note=note,
            source_id=source.id,
        ),
    }


def stock_for(user, raw_code: str) -> tuple[Stock, int, bool]:
    stock = _ensure_stock(raw_code)
    attention = stock.likes.count()
    liked = stock.likes.filter(user=user).exists()
    return stock, attention, liked


def toggle_stock_like(user, raw_code: str) -> tuple[Stock, int, bool]:
    stock = _ensure_stock(raw_code)
    like = StockLike.objects.filter(user=user, stock=stock).first()
    if like:
        like.delete()
        _record(user, stock, Activity.UNLIKE)
    else:
        StockLike.objects.create(user=user, stock=stock)
        _record(user, stock, Activity.LIKE)
    return stock_for(user, stock.code)


def add_comment(user, raw_code: str, body: str) -> Comment:
    text = str(body or "").strip()
    if not text:
        raise ValidationError("写一点再发送")
    if len(text) > 500:
        raise ValidationError("评论最多 500 字")
    stock = _ensure_stock(raw_code)
    comment = Comment.objects.create(user=user, stock=stock, body=text)
    _record(user, stock, Activity.COMMENT, note=text)
    return comment


def toggle_comment_like(user, comment_id: int) -> Comment:
    comment = Comment.objects.filter(pk=comment_id).first()
    if comment is None:
        raise NotFound("没有找到这条评论")
    like = CommentLike.objects.filter(user=user, comment=comment).first()
    if like:
        like.delete()
        _record(user, comment.stock, Activity.COMMENT_UNLIKE, note=comment.body)
    else:
        CommentLike.objects.create(user=user, comment=comment)
        _record(user, comment.stock, Activity.COMMENT_LIKE, note=comment.body)
    return comment_queryset(user, comment.stock, limit=None).get(pk=comment.id)


def client_headlines(raw) -> list[Headline]:
    if not isinstance(raw, list):
        return []
    items = []
    for row in raw[:8]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()[:120]
        if not title:
            continue
        items.append(
            Headline(
                title=title,
                media=str(row.get("media") or "").strip()[:40],
                published_at=str(row.get("published_at") or "").strip()[:19],
                url=str(row.get("url") or "").strip()[:300],
            )
        )
    return items


def risk_for(raw_code: str, *, force: bool, headlines: list[Headline] | None = None, quote_text: str = "") -> RiskReport | None:
    stock = _ensure_stock(raw_code)
    latest = stock.reports.order_by("-id").first()
    fresh_for = timedelta(hours=settings.RISK_FRESH_HOURS)
    fresh = latest and not force and timezone.now() - latest.created_at < fresh_for
    if fresh and latest.checks:
        return latest
    if not force:
        return latest
    if headlines is None:
        headlines = []
    supplied = str(quote_text or "").strip()
    price = supplied or (f"现价 {stock.price}，涨跌幅 {stock.change_pct}%" if stock.price is not None else "暂无现价")
    report = build_report(stock.name, stock.code, price, headlines)
    return RiskReport.objects.create(
        stock=stock,
        summary=report["summary"],
        regulatory=report["regulatory"],
        negative_news=report["negative_news"],
        other_risks=report["other_risks"],
        checks=report["checks"],
        headlines=[
            {
                "title": item.title,
                "media": item.media,
                "published_at": item.published_at,
                "url": item.url,
            }
            for item in headlines
        ],
        stance=report["stance"],
        source=report["source"],
        model=report["model"],
    )
