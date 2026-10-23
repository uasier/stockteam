from decimal import Decimal, InvalidOperation

from django.utils import timezone

from .models import Stock
from .quotes import Quote


def apply_quote(stock: Stock, quote: Quote) -> None:
    if quote.name:
        stock.name = quote.name[:64]
    stock.price = quote.price
    stock.change_pct = quote.change_pct
    stock.open_price = quote.open_price
    stock.high = quote.high
    stock.low = quote.low
    stock.prev_close = quote.prev_close
    stock.quoted_at = timezone.now()
    stock.save()


def _decimal(value):
    if value is None or value == "" or value == "-":
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    return number


def store_quotes(items: list) -> list[Stock]:
    """只保存设备已经取到的行情，服务器不再访问行情源。"""
    saved = []
    for raw in items[:80]:
        if not isinstance(raw, dict):
            continue
        code = str(raw.get("code") or "").strip()
        if len(code) != 6 or not code.isdigit():
            continue
        quote = Quote(
            code=code,
            name=str(raw.get("name") or "").strip(),
            price=_decimal(raw.get("price")),
            change_pct=_decimal(raw.get("change_pct")),
            open_price=_decimal(raw.get("open")),
            high=_decimal(raw.get("high")),
            low=_decimal(raw.get("low")),
            prev_close=_decimal(raw.get("prev_close")),
        )
        stock, _ = Stock.objects.get_or_create(code=code, defaults={"name": quote.name or code})
        apply_quote(stock, quote)
        saved.append(stock)
    return saved
