"""东方财富公开行情与新闻标题。

实时报价使用 push2delay / push2 的 ulist 接口，字段与仓库里原有的
Rust 行情客户端一致：f12 代码、f14 名称、f2 现价、f3 涨跌幅。
北交所 92 开头的代码在东方财富的 secid 是 `0.`，不是沪市的 `1.`。
"""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import requests

ULIST_URLS = (
    "https://push2delay.eastmoney.com/api/qt/ulist.np/get",
    "https://push2.eastmoney.com/api/qt/ulist.np/get",
)
SUGGEST_URL = "https://searchapi.eastmoney.com/api/suggest/get"
TENCENT_SUGGEST_URL = "https://smartbox.gtimg.cn/s3/"
A_SHARE_MARKETS = {"沪A", "深A", "科创板", "京A", "创业板"}
NEWS_URL = "https://search-api-web.eastmoney.com/search/jsonp"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://quote.eastmoney.com/",
}
CODE_RE = re.compile(r"\d{6}")
CONNECT_TIMEOUT = 2
READ_TIMEOUT = 4
PROXY_ENV = ("https_proxy", "http_proxy", "all_proxy", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY")


class QuoteError(Exception):
    pass


@dataclass
class Quote:
    code: str
    name: str
    price: Decimal | None
    change_pct: Decimal | None
    open_price: Decimal | None
    high: Decimal | None
    low: Decimal | None
    prev_close: Decimal | None


@dataclass
class Headline:
    title: str
    media: str
    published_at: str
    url: str


def normalize_code(raw: str | None) -> str:
    matched = CODE_RE.search(str(raw or ""))
    return matched.group(0) if matched else ""


def eastmoney_secid(code: str) -> str | None:
    """沪市 5/6/9 用 1.，其余 A 股用 0.。92 开头的北交所代码例外，实测要走 0.。"""
    text = code.strip()
    if len(text) != 6 or not text.isdigit():
        return None
    if text.startswith(("43", "82", "83", "87", "88", "92")):
        return f"0.{text}"
    if text.startswith(("5", "6", "9")):
        return f"1.{text}"
    if text.startswith(("0", "1", "2", "3", "4", "8")):
        return f"0.{text}"
    return None


def _number(value, places: str) -> Decimal | None:
    if value is None or value == "" or value == "-":
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    return number.quantize(Decimal(places))


def _price(value) -> Decimal | None:
    number = _number(value, "0.001")
    if number is None or number <= 0:
        return None
    return number


def _pct(value) -> Decimal | None:
    return _number(value, "0.001")


def _rows(payload: dict) -> list[dict]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return []
    diff = data.get("diff")
    if isinstance(diff, list):
        return [row for row in diff if isinstance(row, dict)]
    if isinstance(diff, dict):
        return [row for row in diff.values() if isinstance(row, dict)]
    return []


def parse_ulist(payload: dict) -> list[Quote]:
    quotes = []
    for row in _rows(payload):
        code = normalize_code(row.get("f12"))
        if not code:
            continue
        quotes.append(
            Quote(
                code=code,
                name=str(row.get("f14") or "").strip(),
                price=_price(row.get("f2")),
                change_pct=_pct(row.get("f3")),
                open_price=_price(row.get("f17")),
                high=_price(row.get("f15")),
                low=_price(row.get("f16")),
                prev_close=_price(row.get("f18")),
            )
        )
    return quotes


def _a_share_market(code: str, market: str = "", classify: str = "") -> str:
    label = market.strip()
    if label in A_SHARE_MARKETS:
        return label
    if label:
        return ""
    if classify not in {"", "AStock", "NEEQ", "23", "80", "81"}:
        return ""
    if code.startswith("688"):
        return "科创板"
    if code.startswith(("60", "68")):
        return "沪A"
    if code.startswith("30"):
        return "创业板"
    if code.startswith(("92", "83", "87", "43")):
        return "京A"
    if code.startswith("00"):
        return "深A"
    return ""


def parse_suggest(payload: dict) -> list[dict]:
    table = payload.get("QuotationCodeTable") if isinstance(payload, dict) else None
    rows = table.get("Data") if isinstance(table, dict) else None
    if not isinstance(rows, list):
        return []
    items = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = normalize_code(row.get("Code"))
        market = _a_share_market(code or "", str(row.get("SecurityTypeName") or ""), str(row.get("Classify") or ""))
        if not code or not market or code in seen or eastmoney_secid(code) is None:
            continue
        seen.add(code)
        items.append(
            {
                "code": code,
                "name": str(row.get("Name") or "").strip(),
                "market": market,
                "pinyin": str(row.get("PinYin") or "").strip().lower(),
            }
        )
    return items


def parse_tencent(text: str) -> list[dict]:
    matched = re.search(r'v_hint="(.*)"', text or "")
    if not matched:
        return []
    body = matched.group(1)
    if body in {"", "N"}:
        return []
    if "\\u" in body:
        body = body.encode("utf-8").decode("unicode_escape")
    items = []
    seen = set()
    for part in body.split("^"):
        bits = part.split("~")
        if len(bits) < 5:
            continue
        code = normalize_code(bits[1])
        if not code or code in seen or not bits[4].startswith("GP-A") or eastmoney_secid(code) is None:
            continue
        seen.add(code)
        items.append(
            {
                "code": code,
                "name": bits[2].strip(),
                "market": _a_share_market(code),
                "pinyin": bits[3].strip().lower(),
            }
        )
    return items


def parse_news(payload: dict) -> list[Headline]:
    result = payload.get("result") if isinstance(payload, dict) else None
    rows = result.get("cmsArticleWebOld") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        return []
    headlines = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        headlines.append(
            Headline(
                title=title[:120],
                media=str(row.get("mediaName") or "").strip()[:40],
                published_at=str(row.get("date") or "").strip()[:19],
                url=str(row.get("url") or "").strip(),
            )
        )
        if len(headlines) >= 8:
            break
    return headlines


def _proxy_configured() -> bool:
    return any(os.environ.get(name) for name in PROXY_ENV)


def _modes() -> tuple[bool, ...]:
    """False 是直连。只有环境里真有代理时才同时再试代理。"""
    if _proxy_configured():
        return (False, True)
    return (False,)


def _race(jobs: list):
    """同时发出请求，采用第一个非空结果。失败的来源不再往后排队等超时。"""
    if not jobs:
        raise QuoteError("行情接口没有响应")
    if len(jobs) == 1:
        value = jobs[0]()
        if not value:
            raise QuoteError("行情接口没有响应")
        return value
    pool = ThreadPoolExecutor(max_workers=len(jobs))
    futures = [pool.submit(job) for job in jobs]
    errors: list[Exception] = []
    try:
        for future in as_completed(futures):
            try:
                value = future.result()
            except Exception as exc:
                errors.append(exc)
                continue
            if value:
                return value
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    raise QuoteError("行情接口没有响应") from (errors[-1] if errors else None)


def _read_json(url: str, params: dict, trust_env: bool, headers: dict | None = None) -> dict:
    session = requests.Session()
    session.trust_env = trust_env
    response = session.get(
        url,
        params=params,
        headers=headers or HEADERS,
        timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise QuoteError("行情接口没有响应")
    return payload


def _get_json(url: str, params: dict, headers: dict | None = None) -> dict:
    return _race([lambda mode=mode: _read_json(url, params, mode, headers) for mode in _modes()])


def sina_symbol(code: str) -> str | None:
    text = code.strip()
    if len(text) != 6 or not text.isdigit():
        return None
    if text.startswith(("43", "82", "83", "87", "88", "92")):
        return f"bj{text}"
    if text.startswith(("5", "6", "9")):
        return f"sh{text}"
    if text.startswith(("0", "1", "2", "3", "4", "8")):
        return f"sz{text}"
    return None


def parse_sina(text: str) -> list[Quote]:
    quotes = []
    for line in text.splitlines():
        if "=" not in line:
            continue
        left, right = line.split("=", 1)
        code = normalize_code(left)
        body = right.strip().strip(";").strip().strip('"')
        parts = body.split(",") if body else []
        if not code or len(parts) < 6:
            continue
        price = _price(parts[3])
        prev_close = _price(parts[2])
        change_pct = None
        if price is not None and prev_close is not None and prev_close != 0:
            change_pct = ((price - prev_close) / prev_close * Decimal("100")).quantize(Decimal("0.001"))
        quotes.append(
            Quote(
                code=code,
                name=parts[0].strip(),
                price=price,
                change_pct=change_pct,
                open_price=_price(parts[1]),
                high=_price(parts[4]),
                low=_price(parts[5]),
                prev_close=prev_close,
            )
        )
    return quotes


def _fetch_eastmoney(codes: list[str]) -> list[Quote]:
    pairs = [(code, secid) for code in codes if (secid := eastmoney_secid(code))]
    collected: list[Quote] = []
    last_error: QuoteError | None = None
    for start in range(0, len(pairs), 40):
        chunk = pairs[start : start + 40]
        params = {
            "fltt": "2",
            "invt": "2",
            "fields": "f12,f14,f2,f3,f15,f16,f17,f18",
            "secids": ",".join(secid for _, secid in chunk),
        }
        def load(url: str) -> list[Quote]:
            return parse_ulist(_get_json(url, params))

        try:
            parsed = _race([lambda url=url: load(url) for url in ULIST_URLS])
            last_error = None
        except QuoteError as exc:
            parsed = []
            last_error = exc
        if last_error and not collected and start == 0:
            raise last_error
        collected.extend(parsed)
    return collected


def _fetch_sina(codes: list[str]) -> list[Quote]:
    symbols = [symbol for code in codes if (symbol := sina_symbol(code))]
    if not symbols:
        return []
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"}

    def load(trust_env: bool) -> list[Quote]:
        session = requests.Session()
        session.trust_env = trust_env
        response = session.get(
            "https://hq.sinajs.cn/list=" + ",".join(symbols),
            headers=headers,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
        )
        response.raise_for_status()
        parsed = parse_sina(response.content.decode("gbk", errors="replace"))
        if not parsed:
            raise QuoteError("行情接口没有响应")
        return parsed

    return _race([lambda mode=mode: load(mode) for mode in _modes()])


def fetch_quotes(codes: list[str]) -> list[Quote]:
    if not codes:
        return []
    try:
        quotes = _fetch_eastmoney(codes)
        if quotes:
            return quotes
    except QuoteError:
        quotes = []
    sina_quotes = _fetch_sina(codes)
    if sina_quotes:
        return sina_quotes
    raise QuoteError("行情接口没有响应")


def _load_eastmoney_suggest(keyword: str) -> list[dict]:
    params = {
        "input": keyword,
        "type": "14",
        "token": "D43BF722C8E33BDC906FB84D85E326E8",
        "count": "8",
    }
    return parse_suggest(_get_json(SUGGEST_URL, params))


def _load_tencent_suggest(keyword: str) -> list[dict]:
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"}

    def load(trust_env: bool) -> list[dict]:
        session = requests.Session()
        session.trust_env = trust_env
        response = session.get(
            TENCENT_SUGGEST_URL,
            params={"v": "2", "q": keyword, "t": "gp"},
            headers=headers,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
        )
        response.raise_for_status()
        text = response.content.decode("utf-8", errors="replace")
        if "v_hint" not in text:
            text = response.content.decode("gbk", errors="replace")
        items = parse_tencent(text)
        if not items:
            raise QuoteError("没有搜索结果")
        return items

    return _race([lambda mode=mode: load(mode) for mode in _modes()])


def search_stocks(keyword: str) -> list[dict]:
    """名称、代码、拼音首字母。腾讯对简写首字母更准，东方财富补科创板和北交所。"""
    text = str(keyword or "").strip()
    if not text:
        return []
    pool = ThreadPoolExecutor(max_workers=2)
    eastmoney = pool.submit(_load_eastmoney_suggest, text)
    tencent = pool.submit(_load_tencent_suggest, text)
    found = {"eastmoney": [], "tencent": []}
    for key, future in (("eastmoney", eastmoney), ("tencent", tencent)):
        try:
            found[key] = future.result()
        except Exception:
            found[key] = []
    pool.shutdown(wait=False, cancel_futures=True)
    items = []
    seen = set()
    for source in ("tencent", "eastmoney"):
        for item in found[source]:
            if item["code"] in seen:
                continue
            seen.add(item["code"])
            items.append({"code": item["code"], "name": item["name"], "market": item["market"]})
            if len(items) >= 8:
                return items
    return items


def fetch_headlines(keyword: str) -> list[Headline]:
    param = {
        "uid": "",
        "keyword": keyword,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "time",
                "pageIndex": 1,
                "pageSize": 8,
                "preTag": "",
                "postTag": "",
            }
        },
    }
    headers = {**HEADERS, "Referer": "https://so.eastmoney.com/"}
    params = {"cb": "cb", "param": json.dumps(param, ensure_ascii=False)}

    def load(trust_env: bool) -> list[Headline]:
        session = requests.Session()
        session.trust_env = trust_env
        response = session.get(NEWS_URL, params=params, headers=headers, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
        response.raise_for_status()
        text = response.text.strip()
        if text.startswith("cb("):
            text = text[3:]
        if text.endswith(");"):
            text = text[:-2]
        elif text.endswith(")"):
            text = text[:-1]
        try:
            payload = json.loads(text)
        except ValueError as exc:
            raise QuoteError("新闻标题无法解析") from exc
        headlines = parse_news(payload)
        if not headlines:
            raise QuoteError("新闻标题没有取到")
        return headlines

    return _race([lambda mode=mode: load(mode) for mode in _modes()])
