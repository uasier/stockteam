from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .models import Stock
from .quotes import Quote, QuoteError, fetch_quotes

CACHE_PREFIX = "gp:quote:"


def _cache_get(key: str):
    try:
        return cache.get(key)
    except Exception:
        return None


def _cache_set(key: str, value, ttl: int) -> None:
    try:
        cache.set(key, value, ttl)
    except Exception:
        return


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


def refresh_quotes(codes: list[str], *, force: bool) -> list[Stock]:
    """取行情并写回股票表。force 为假时，缓存未过期的代码不再请求上游。"""
    pending = []
    cached_codes = []
    for code in codes:
        blob = None if force else _cache_get(CACHE_PREFIX + code)
        if blob is None:
            pending.append(code)
        else:
            cached_codes.append(code)
    if pending:
        quotes = fetch_quotes(pending)
        by_code = {quote.code: quote for quote in quotes}
        for code in pending:
            quote = by_code.get(code)
            if quote is None:
                continue
            stock, _ = Stock.objects.get_or_create(code=code, defaults={"name": quote.name or code})
            apply_quote(stock, quote)
            _cache_set(CACHE_PREFIX + code, code, settings.QUOTE_CACHE_SECONDS)
    stocks = list(Stock.objects.filter(code__in=codes))
    order = {code: index for index, code in enumerate(codes)}
    stocks.sort(key=lambda item: order.get(item.code, 0))
    if pending and not stocks and not cached_codes:
        raise QuoteError("行情暂时没有取到")
    return stocks
