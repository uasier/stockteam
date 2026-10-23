import json
import os
from decimal import Decimal
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts.models import User
from circle.models import Stock
import requests

from circle.quotes import (
    CONNECT_TIMEOUT,
    PROXY_ENV,
    READ_TIMEOUT,
    Headline,
    QuoteError,
    _modes,
    _race,
    eastmoney_secid,
    fetch_quotes,
    parse_news,
    parse_sina,
    parse_suggest,
    parse_tencent,
    parse_ulist,
    sina_symbol,
)
from circle.risk import build_report, scan_headlines, stance_of


def fake_refresh(codes, force=False):
    stocks = []
    for code in codes:
        stock, _ = Stock.objects.get_or_create(code=code, defaults={"name": code})
        stock.name = "贵州茅台" if code == "600519" else stock.name or code
        stock.price = Decimal("1335.000")
        stock.change_pct = Decimal("1.250")
        stock.quoted_at = timezone.now()
        stock.save()
        stocks.append(stock)
    return stocks


class QuoteParseTests(SimpleTestCase):
    def test_secid_matches_exchange(self):
        self.assertEqual(eastmoney_secid("600519"), "1.600519")
        self.assertEqual(eastmoney_secid("688981"), "1.688981")
        self.assertEqual(eastmoney_secid("000001"), "0.000001")
        self.assertEqual(eastmoney_secid("300750"), "0.300750")
        self.assertEqual(eastmoney_secid("920027"), "0.920027")
        self.assertEqual(eastmoney_secid("830799"), "0.830799")

    def test_parse_ulist_keeps_negative_change(self):
        quotes = parse_ulist(
            {"data": {"diff": [{"f12": "600519", "f14": "贵州茅台", "f2": 1335, "f3": -1.25}]}}
        )
        self.assertEqual(quotes[0].name, "贵州茅台")
        self.assertEqual(quotes[0].change_pct, Decimal("-1.250"))

    def test_parse_sina_fallback_quote(self):
        self.assertEqual(sina_symbol("600519"), "sh600519")
        self.assertEqual(sina_symbol("000001"), "sz000001")
        self.assertEqual(sina_symbol("920027"), "bj920027")
        quotes = parse_sina(
            'var hq_str_sh600519="贵州茅台,1311.840,1318.490,1335.000,1343.880,1310.000";'
        )
        self.assertEqual(quotes[0].name, "贵州茅台")
        self.assertEqual(quotes[0].price, Decimal("1335.000"))
        self.assertGreater(quotes[0].change_pct, 0)

    def test_parse_suggest_and_news(self):
        items = parse_suggest(
            {
                "QuotationCodeTable": {
                    "Data": [
                        {"Code": "600519", "Name": "贵州茅台", "Classify": "AStock", "SecurityTypeName": "沪A"},
                        {"Code": "000001", "Name": "上证指数", "Classify": "Index", "SecurityTypeName": "指数"},
                    ]
                }
            }
        )
        self.assertEqual(items, [{"code": "600519", "name": "贵州茅台", "market": "沪A", "pinyin": ""}])
        kept = parse_suggest(
            {
                "QuotationCodeTable": {
                    "Data": [
                        {"Code": "688981", "Name": "中芯国际", "PinYin": "ZXGJ", "Classify": "23", "SecurityTypeName": "科创板"},
                        {"Code": "920027", "Name": "交大铁发", "PinYin": "JDTF", "Classify": "NEEQ", "SecurityTypeName": "京A"},
                        {"Code": "MAT", "Name": "美泰", "PinYin": "MT", "Classify": "UsStock", "SecurityTypeName": "美股"},
                    ]
                }
            }
        )
        self.assertEqual([item["code"] for item in kept], ["688981", "920027"])
        headlines = parse_news(
            {"result": {"cmsArticleWebOld": [{"title": "减持公告", "mediaName": "交易所", "date": "2026-10-23", "url": "https://example.com"}]}}
        )
        self.assertEqual(headlines[0].title, "减持公告")
        hint = (
            r'v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A'
            r'^sz~399990~\u7164\u70ad\u7b49\u6743~mtdq~ZS'
            r'^sh~688981~\u4e2d\u82af\u56fd\u9645~zxgj~GP-A-KCB";'
        )
        tencent = parse_tencent(hint)
        self.assertEqual([(item["code"], item["name"]) for item in tencent], [("600519", "贵州茅台"), ("688981", "中芯国际")])

    def test_quote_requests_skip_proxy_and_race_sources(self):
        cleared = {name: "" for name in PROXY_ENV}
        with patch.dict(os.environ, cleared, clear=False):
            self.assertEqual(_modes(), (False,))
        with patch.dict(os.environ, {"https_proxy": "http://127.0.0.1:7890"}, clear=False):
            self.assertEqual(_modes(), (False, True))

        def fail():
            raise QuoteError("slow")

        self.assertEqual(_race([fail, lambda: [], lambda: ["600519"]]), ["600519"])

        seen: list[tuple[float, float]] = []

        def fake_get(self, url, params=None, headers=None, timeout=None):
            seen.append(timeout)
            if "push2delay" in url:
                raise requests.Timeout("slow")

            class Response:
                def raise_for_status(self):
                    return None

                def json(self):
                    return {"data": {"diff": [{"f12": "600519", "f14": "贵州茅台", "f2": 10, "f3": 1.5}]}}

            return Response()

        with patch.dict(os.environ, cleared, clear=False):
            with patch("circle.quotes.requests.Session.get", fake_get):
                quotes = fetch_quotes(["600519"])
        self.assertIn((CONNECT_TIMEOUT, READ_TIMEOUT), seen)
        self.assertEqual(quotes[0].code, "600519")
        self.assertEqual(quotes[0].name, "贵州茅台")

    def test_report_without_model_does_not_invent_news(self):
        report = build_report("贵州茅台", "600519", "现价 1", [], api_key="")
        self.assertEqual(report["source"], "unconfigured")
        self.assertEqual(report["stance"], "unknown")
        self.assertIn("没有配置分析模型", report["summary"])
        self.assertTrue(all(item["status"] == "unknown" for item in report["checks"]))

        titled = build_report(
            "贵州茅台",
            "600519",
            "现价 1",
            [Headline("公司发布减持计划", "交易所", "2026-10-23", "https://example.com/a")],
            api_key="",
        )
        self.assertEqual(titled["stance"], "attention")
        self.assertEqual(titled["source"], "unconfigured")
        cut = next(item for item in titled["checks"] if item["name"] == "股东减持")
        self.assertEqual(cut["status"], "seen")
        self.assertEqual(cut["evidence"], ["公司发布减持计划"])
        inquiry = next(item for item in titled["checks"] if item["name"] == "监管问询")
        self.assertEqual(inquiry["status"], "unseen")
        self.assertIn("没有出现", titled["regulatory"])
        self.assertNotIn("标题中出现", titled["regulatory"])

        quiet = scan_headlines([Headline("公司发布新品", "公司", "2026-10-23", "")])
        self.assertEqual(stance_of(quiet), "quiet")
        self.assertTrue(all(item["status"] == "unseen" for item in quiet))

    def test_model_report_cannot_override_title_checks(self):
        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "summary": "标题里写了减持。",
                                        "regulatory": "标题里没有问询或立案。",
                                        "negative_news": "标题里出现减持。",
                                        "other_risks": ["只看到减持"],
                                        "stance": "sell",
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                }

        with patch("circle.risk.requests.post", return_value=Response()):
            report = build_report(
                "贵州茅台",
                "600519",
                "现价 1",
                [Headline("公司发布减持计划", "交易所", "2026-10-23", "https://example.com/a")],
                api_key="sk-test",
            )
        self.assertEqual(report["source"], "model")
        self.assertEqual(report["stance"], "attention")
        self.assertEqual(report["summary"], "标题里写了减持。")
        self.assertNotIn("卖出", report["summary"])
        cut = next(item for item in report["checks"] if item["name"] == "股东减持")
        self.assertEqual(cut["status"], "seen")


class CircleApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(username="lin", password="pass-word-1")
        self.other = User.objects.create_user(username="min", password="pass-word-1")
        self.owner_token = Token.objects.create(user=self.owner)
        self.other_token = Token.objects.create(user=self.other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.owner_token.key}")

    def auth_as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_watch_buy_sell_and_sort_fields(self):
        created = self.client.post("/api/watch", {"code": "600519", "name": "贵州茅台", "price": "1335"}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["stock"]["name"], "贵州茅台")
        self.assertEqual(created.data["custom_price"], "1335.000")
        duplicate = self.client.post("/api/watch", {"code": "600519"}, format="json")
        self.assertEqual(duplicate.status_code, 400)

        tagged = self.client.patch(
            f"/api/watch/{created.data['id']}",
            {"tag_names": ["白酒", "核心"], "custom_price": "1600"},
            format="json",
        )
        self.assertEqual(tagged.data["tags"], ["白酒", "核心"])
        self.assertEqual(tagged.data["custom_price"], "1600.000")

        listed = self.client.get("/api/watch")
        self.assertEqual(len(listed.data["items"]), 1)
        self.assertEqual(listed.data["items"][0]["user"]["username"], "lin")
        self.assertTrue(listed.data["items"][0]["mine"])

    def test_group_can_see_who_added_a_watch(self):
        created = self.client.post("/api/watch", {"code": "600519"}, format="json")
        self.assertEqual(created.status_code, 201)

        self.auth_as(self.other_token)
        seen = self.client.get("/api/watch")
        self.assertEqual(seen.status_code, 200)
        self.assertEqual(len(seen.data["items"]), 1)
        self.assertEqual(seen.data["items"][0]["user"]["username"], "lin")
        self.assertFalse(seen.data["items"][0]["mine"])
        before = self.client.get("/api/stocks/600519")
        self.assertIsNone(before.data["watch"])
        self.assertEqual(before.data["watchers"][0]["user"]["username"], "lin")

        joined = self.client.post("/api/watch", {"code": "600519"}, format="json")
        self.assertEqual(joined.status_code, 201)
        self.assertEqual(joined.data["user"]["username"], "min")
        self.assertIsNone(joined.data["custom_price"])
        names = {item["user"]["username"] for item in self.client.get("/api/watch").data["items"]}
        self.assertEqual(names, {"lin", "min"})

        denied = self.client.patch(
            f"/api/watch/{created.data['id']}",
            {"note": "不能改别人的自选"},
            format="json",
        )
        self.assertEqual(denied.status_code, 404)

        detail = self.client.get("/api/stocks/600519")
        self.assertEqual(detail.data["watch"]["user"]["username"], "min")
        self.assertEqual(
            {item["user"]["username"] for item in detail.data["watchers"]},
            {"lin", "min"},
        )

        bought = self.client.post(
            "/api/holdings",
            {"code": "600519", "cost_price": "1300", "quantity": "100", "note": "第一笔"},
            format="json",
        )
        self.assertEqual(bought.status_code, 201)
        self.assertEqual(bought.data["status"], "open")
        self.assertIsNone(bought.data["quantity"])
        self.auth_as(self.owner_token)
        board = self.client.get("/api/holdings?status=open")
        self.assertEqual(board.data["items"][0]["user"]["username"], "min")
        self.assertFalse(board.data["items"][0]["mine"])
        self.auth_as(self.other_token)
        again = self.client.post(
            "/api/holdings",
            {"code": "600519", "cost_price": "1300"},
            format="json",
        )
        self.assertEqual(again.status_code, 400)

        sold = self.client.post(
            f"/api/holdings/{bought.data['id']}/sell",
            {"sell_price": "1400"},
            format="json",
        )
        self.assertEqual(sold.status_code, 200)
        self.assertEqual(sold.data["status"], "closed")
        self.assertEqual(sold.data["pnl_pct"], "7.69")
        closed = self.client.get("/api/holdings?status=closed")
        self.assertEqual(len(closed.data["items"]), 1)
        opened = self.client.get("/api/holdings?status=open")
        self.assertEqual(opened.data["items"], [])

    def test_follow_like_and_comment(self):
        self.auth_as(self.other_token)
        bought = self.client.post(
            "/api/holdings",
            {"code": "600519", "cost_price": "1288", "quantity": "200"},
            format="json",
        )
        feed = self.client.get("/api/feed")
        activity_id = feed.data["items"][0]["id"]

        self.auth_as(self.owner_token)
        own = self.client.post("/api/feed/%s/follow" % activity_id, {}, format="json")
        self.assertEqual(own.status_code, 201)
        self.assertEqual(own.data["kind"], "buy")
        self.assertEqual(own.data["holding"]["cost_price"], "1288.000")

        self.client.post("/api/feed/%s/follow" % activity_id, {}, format="json")
        self.assertEqual(
            self.client.post("/api/feed/%s/follow" % activity_id, {}, format="json").status_code,
            400,
        )

        liked = self.client.post("/api/stocks/600519/like")
        self.assertTrue(liked.data["liked"])
        self.assertEqual(liked.data["attention"], 1)
        unliked = self.client.post("/api/stocks/600519/like")
        self.assertFalse(unliked.data["liked"])

        comment = self.client.post("/api/stocks/600519/comments", {"body": "标题里提到减持"}, format="json")
        self.assertEqual(comment.status_code, 201)
        plus = self.client.post(f"/api/comments/{comment.data['id']}/like")
        self.assertEqual(plus.data["like_count"], 1)
        comments = self.client.get("/api/stocks/600519/comments")
        self.assertEqual(comments.data["items"][0]["body"], "标题里提到减持")

        self.auth_as(self.other_token)
        sell = self.client.post(f"/api/holdings/{bought.data['id']}/sell", {"sell_price": "1300"}, format="json")
        self.assertEqual(sell.status_code, 200)
        sell_feed = self.client.get("/api/feed")
        sell_id = next(item["id"] for item in sell_feed.data["items"] if item["kind"] == "sell")
        trades = self.client.get("/api/feed?kind=trade")
        trade_kinds = {item["kind"] for item in trades.data["items"]}
        self.assertEqual(trade_kinds, {"buy", "sell"})

        self.auth_as(self.owner_token)
        followed = self.client.post(f"/api/feed/{sell_id}/follow", {"price": "1310"}, format="json")
        self.assertEqual(followed.status_code, 201)
        self.assertEqual(followed.data["holding"]["status"], "closed")
        self.assertEqual(followed.data["holding"]["sell_price"], "1310.000")

        self.auth_as(self.other_token)
        cannot = self.client.post(f"/api/feed/{sell_id}/follow", {}, format="json")
        self.assertEqual(cannot.status_code, 400)

    def test_circle_actions_are_saved_to_the_feed(self):
        created = self.client.post("/api/watch", {"code": "600519", "name": "贵州茅台", "price": "1335"}, format="json")
        self.client.patch(
            f"/api/watch/{created.data['id']}",
            {"tag_names": ["白酒"], "note": "先看着"},
            format="json",
        )
        self.client.post("/api/stocks/600519/like")
        self.client.post("/api/stocks/600519/like")
        comment = self.client.post("/api/stocks/600519/comments", {"body": "看看公告"}, format="json")
        self.client.post(f"/api/comments/{comment.data['id']}/like")
        removed = self.client.delete(f"/api/watch/{created.data['id']}")
        self.assertEqual(removed.status_code, 200)

        self.auth_as(self.other_token)
        feed = self.client.get("/api/feed")
        kinds = [item["kind"] for item in feed.data["items"]]
        self.assertEqual(
            kinds,
            ["unwatch", "comment_like", "comment", "unlike", "like", "watch_edit", "watch"],
        )
        self.assertTrue(all(item["user"]["username"] == "lin" for item in feed.data["items"]))
        self.assertEqual(feed.data["items"][-1]["note"].startswith("自选价"), True)
        comment_item = next(item for item in feed.data["items"] if item["kind"] == "comment")
        self.assertEqual(comment_item["note"], "看看公告")
        watch_id = next(item["id"] for item in feed.data["items"] if item["kind"] == "watch")
        followed = self.client.post(f"/api/feed/{watch_id}/follow", {}, format="json")
        self.assertEqual(followed.status_code, 201)
        self.assertEqual(followed.data["kind"], "watch")
        self.assertIsNone(followed.data["watch"]["custom_price"])
        self.assertEqual(followed.data["watch"]["user"]["username"], "min")
        trades = self.client.get("/api/feed?kind=trade")
        self.assertEqual(trades.status_code, 200)
        self.assertEqual(trades.data["items"], [])

    def test_feed_filters_by_activity_kind(self):
        self.client.post("/api/watch", {"code": "600519"}, format="json")
        self.client.post("/api/holdings", {"code": "600519", "cost_price": "1288"}, format="json")
        self.client.post("/api/stocks/600519/comments", {"body": "看看公告"}, format="json")

        buys = self.client.get("/api/feed", {"kind": "buy"})
        self.assertEqual(buys.status_code, 200)
        self.assertEqual([item["kind"] for item in buys.data["items"]], ["buy"])

        comments = self.client.get("/api/feed", {"kind": "comment"})
        self.assertEqual(comments.data["items"][0]["note"], "看看公告")
        self.assertTrue(all(item["kind"] == "comment" for item in comments.data["items"]))

        blank = self.client.get("/api/feed", {"kind": " "})
        self.assertEqual(blank.status_code, 200)
        self.assertGreater(len(blank.data["items"]), 1)

        unknown = self.client.get("/api/feed", {"kind": "nope"})
        self.assertEqual(unknown.status_code, 400)
        self.assertIn("动态类型", unknown.data["error"])

    def test_stock_timeline_lists_what_happened_and_when(self):
        self.client.post("/api/watch", {"code": "600519"}, format="json")
        self.client.post("/api/holdings", {"code": "600519", "cost_price": "1288"}, format="json")
        self.client.post("/api/stocks/600519/comments", {"body": "看看公告"}, format="json")
        self.client.post("/api/watch", {"code": "000001"}, format="json")

        timeline = self.client.get("/api/stocks/600519/timeline")
        self.assertEqual(timeline.status_code, 200)
        self.assertEqual([item["kind"] for item in timeline.data["items"]], ["comment", "buy", "watch"])
        self.assertTrue(all(item["stock"]["code"] == "600519" for item in timeline.data["items"]))
        self.assertTrue(all(item["created_at"] for item in timeline.data["items"]))
        self.assertEqual(timeline.data["items"][0]["note"], "看看公告")
        self.assertEqual(timeline.data["items"][0]["user"]["username"], "lin")
        self.assertEqual(timeline.data["items"][1]["price"], "1288.000")

        other = self.client.get("/api/stocks/000002/timeline")
        self.assertEqual(other.status_code, 200)
        self.assertEqual(other.data["items"], [])
        self.assertFalse(Stock.objects.filter(code="000002").exists())

        invalid = self.client.get("/api/stocks/abc/timeline")
        self.assertEqual(invalid.status_code, 400)

    def test_only_admin_can_edit_deepseek_key(self):
        denied = self.client.get("/api/ai-key")
        self.assertEqual(denied.status_code, 403)
        blocked = self.client.patch("/api/ai-key", {"api_key": "sk-member"}, format="json")
        self.assertEqual(blocked.status_code, 403)

        self.owner.is_staff = True
        self.owner.save(update_fields=["is_staff"])
        saved = self.client.patch("/api/ai-key", {"api_key": " sk-admin "}, format="json")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data["api_key"], "sk-admin")
        self.assertEqual(self.client.get("/api/ai-key").data["api_key"], "sk-admin")
        from circle.risk import current_ai_api_key

        self.assertEqual(current_ai_api_key(), "sk-admin")
        cleared = self.client.patch("/api/ai-key", {"api_key": ""}, format="json")
        self.assertEqual(cleared.data["api_key"], "")
        self.assertEqual(current_ai_api_key(), "")

    def test_risk_report_uses_headlines_sent_by_the_device(self):
        pending = self.client.get("/api/stocks/600519/risk")
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.data["source"], "pending")
        first = self.client.post(
            "/api/stocks/600519/risk",
            {
                "quote_text": "现价 1",
                "headlines": [
                    {
                        "title": "公司发布减持计划",
                        "media": "交易所",
                        "published_at": "2026-10-23",
                        "url": "https://example.com/a",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["source"], "unconfigured")
        self.assertEqual(first.data["stance"], "attention")
        self.assertEqual(first.data["negative_status"], "seen")
        self.assertEqual(first.data["regulatory_status"], "unseen")
        cut = next(item for item in first.data["checks"] if item["name"] == "股东减持")
        self.assertEqual(cut["evidence"], ["公司发布减持计划"])
        self.assertEqual(first.data["headlines"][0]["title"], "公司发布减持计划")
        second = self.client.get("/api/stocks/600519/risk")
        self.assertEqual(first.data["created_at"], second.data["created_at"])

    def test_search_reads_saved_names_without_calling_upstream(self):
        Stock.objects.create(code="600519", name="贵州茅台")
        found = self.client.get("/api/stocks/search", {"q": "茅台"})
        self.assertEqual(found.data["items"][0]["code"], "600519")
