from decimal import Decimal

from .models import Activity, Comment, Holding, RiskReport, WatchItem
from .risk import DISCLAIMER


def dec(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def present_user(user) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "avatar": user.avatar_url(),
    }


def present_stock(stock, *, attention: int, liked: bool) -> dict:
    return {
        "code": stock.code,
        "name": stock.name,
        "price": dec(stock.price),
        "change_pct": dec(stock.change_pct),
        "open": dec(stock.open_price),
        "high": dec(stock.high),
        "low": dec(stock.low),
        "prev_close": dec(stock.prev_close),
        "quoted_at": stock.quoted_at.isoformat() if stock.quoted_at else None,
        "attention": int(attention or 0),
        "liked": bool(liked),
    }


def _pnl(base: Decimal | None, price: Decimal | None) -> str | None:
    if base is None or price is None or base == 0:
        return None
    ratio = ((price - base) / base * Decimal("100")).quantize(Decimal("0.01"))
    return format(ratio, "f")


def present_watch(item: WatchItem, *, viewer_id: int) -> dict:
    attention = getattr(item, "attention", 0)
    liked = getattr(item, "liked", False)
    return {
        "id": item.id,
        "custom_price": dec(item.custom_price),
        "custom_date": item.custom_date.isoformat(),
        "note": item.note,
        "tags": [tag.name for tag in item.tags.all()],
        "mine": item.user_id == viewer_id,
        "user": present_user(item.user),
        "stock": present_stock(item.stock, attention=attention, liked=liked),
    }


def present_holding(item: Holding, *, viewer_id: int) -> dict:
    attention = getattr(item, "attention", 0)
    liked = getattr(item, "liked", False)
    mark = item.sell_price if item.status == Holding.CLOSED else item.stock.price
    return {
        "id": item.id,
        "status": item.status,
        "cost_price": dec(item.cost_price),
        "quantity": dec(item.quantity),
        "sell_price": dec(item.sell_price),
        "opened_at": item.opened_at.isoformat(),
        "closed_at": item.closed_at.isoformat() if item.closed_at else None,
        "note": item.note,
        "pnl_pct": _pnl(item.cost_price, mark),
        "mine": item.user_id == viewer_id,
        "user": present_user(item.user),
        "stock": present_stock(item.stock, attention=attention, liked=liked),
    }


def present_activity(item: Activity) -> dict:
    attention = getattr(item, "attention", 0)
    liked = getattr(item, "liked", False)
    return {
        "id": item.id,
        "kind": item.kind,
        "price": dec(item.price),
        "quantity": dec(item.quantity),
        "note": item.note,
        "created_at": item.created_at.isoformat(),
        "source_id": item.source_id,
        "user": present_user(item.user),
        "stock": present_stock(item.stock, attention=attention, liked=liked),
    }


def present_comment(item: Comment) -> dict:
    return {
        "id": item.id,
        "body": item.body,
        "created_at": item.created_at.isoformat(),
        "like_count": int(getattr(item, "like_count", 0) or 0),
        "liked": bool(getattr(item, "liked", False)),
        "user": present_user(item.user),
    }


def _fold_status(checks, group: str) -> str:
    rows = [item for item in checks if isinstance(item, dict) and item.get("group") == group]
    if any(item.get("status") == "seen" for item in rows):
        return "seen"
    if rows and all(item.get("status") == "unknown" for item in rows):
        return "unknown"
    if not rows:
        return "unknown"
    return "unseen"


def present_risk(report: RiskReport) -> dict:
    checks = report.checks if isinstance(report.checks, list) else []
    return {
        "summary": report.summary,
        "regulatory": report.regulatory,
        "negative_news": report.negative_news,
        "other_risks": report.other_risks,
        "checks": checks,
        "regulatory_status": _fold_status(checks, "regulatory"),
        "negative_status": _fold_status(checks, "negative"),
        "headlines": report.headlines,
        "stance": report.stance,
        "source": report.source,
        "model": report.model,
        "created_at": report.created_at.isoformat(),
        "disclaimer": DISCLAIMER,
    }
