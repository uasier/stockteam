from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsGroupAdmin

from .models import Holding, SiteSetting
from .present import present_activity, present_comment, present_holding, present_risk, present_stock, present_watch
from . import services


class SearchView(APIView):
    def get(self, request):
        return Response({"items": services.search(request.query_params.get("q", ""))})


def _present_quotes(stocks, user):
    items = []
    for stock in stocks:
        attention = stock.likes.count()
        liked = stock.likes.filter(user=user).exists()
        items.append(present_stock(stock, attention=attention, liked=liked))
    return items


class QuoteView(APIView):
    def get(self, request):
        stocks = services.load_quotes(request.query_params.get("codes", ""))
        return Response({"items": _present_quotes(stocks, request.user)})

    def post(self, request):
        quotes = request.data.get("quotes")
        if isinstance(quotes, list) and quotes:
            stocks = services.store_quotes(quotes)
        else:
            stocks = services.load_quotes(request.data.get("codes"))
        return Response({"items": _present_quotes(stocks, request.user)})


class WatchListView(APIView):
    def get(self, request):
        items = [
            present_watch(item, viewer_id=request.user.id)
            for item in services.watch_queryset(request.user)
        ]
        return Response({"items": items})

    def post(self, request):
        item = services.add_watch(
            request.user,
            request.data.get("code", ""),
            name=str(request.data.get("name") or ""),
            price=request.data.get("price"),
        )
        saved = services.own_watch_queryset(request.user).get(pk=item.id)
        return Response(present_watch(saved, viewer_id=request.user.id), status=201)


class WatchDetailView(APIView):
    def patch(self, request, item_id: int):
        item = services.update_watch(request.user, item_id, request.data)
        return Response(present_watch(item, viewer_id=request.user.id))

    def delete(self, request, item_id: int):
        services.remove_watch(request.user, item_id)
        return Response({"ok": True})


class HoldingListView(APIView):
    def get(self, request):
        status = request.query_params.get("status")
        items = [
            present_holding(item, viewer_id=request.user.id)
            for item in services.visible_holdings(request.user, status)
        ]
        return Response({"items": items})

    def post(self, request):
        holding = services.open_holding(
            request.user,
            code=request.data.get("code", ""),
            cost_price=request.data.get("cost_price"),
            note=request.data.get("note", ""),
            source_id=request.data.get("source_activity"),
        )
        return Response(present_holding(holding, viewer_id=request.user.id), status=201)


class HoldingSellView(APIView):
    def post(self, request, item_id: int):
        holding = services.sell_holding(
            request.user,
            item_id,
            sell_price=request.data.get("sell_price"),
            note=request.data.get("note", ""),
            source_id=request.data.get("source_activity"),
        )
        return Response(present_holding(holding, viewer_id=request.user.id))


class FeedView(APIView):
    def get(self, request):
        items = services.activity_queryset(request.user, request.query_params.get("kind"))
        return Response({"items": [present_activity(item) for item in items]})


class FollowView(APIView):
    def post(self, request, activity_id: int):
        result = services.follow_activity(
            request.user,
            activity_id,
            price=request.data.get("price"),
            note=request.data.get("note", ""),
        )
        if result["kind"] == "watch":
            saved = services.own_watch_queryset(request.user).get(pk=result["watch"].id)
            return Response(
                {"kind": "watch", "watch": present_watch(saved, viewer_id=request.user.id)},
                status=201,
            )
        return Response(
            {"kind": result["kind"], "holding": present_holding(result["holding"], viewer_id=request.user.id)},
            status=201,
        )


class StockTimelineView(APIView):
    def get(self, request, code: str):
        items = services.stock_timeline(request.user, code)
        return Response({"items": [present_activity(item) for item in items]})


class StockDetailView(APIView):
    def get(self, request, code: str):
        stock, attention, liked = services.stock_for(request.user, code)
        watch = services.own_watch_queryset(request.user).filter(stock=stock).first()
        watchers = services.watch_queryset(request.user).filter(stock=stock)
        holding = (
            services.holding_queryset(request.user, Holding.OPEN).filter(stock=stock).first()
        )
        return Response(
            {
                "stock": present_stock(stock, attention=attention, liked=liked),
                "watch": present_watch(watch, viewer_id=request.user.id) if watch else None,
                "watchers": [present_watch(item, viewer_id=request.user.id) for item in watchers],
                "holding": present_holding(holding, viewer_id=request.user.id) if holding else None,
            }
        )


class StockLikeView(APIView):
    def post(self, request, code: str):
        stock, attention, liked = services.toggle_stock_like(request.user, code)
        return Response(present_stock(stock, attention=attention, liked=liked))


class CommentListView(APIView):
    def get(self, request, code: str):
        stock, _, _ = services.stock_for(request.user, code)
        items = [present_comment(item) for item in services.comment_queryset(request.user, stock)]
        return Response({"items": items})

    def post(self, request, code: str):
        comment = services.add_comment(request.user, code, request.data.get("body", ""))
        saved = services.comment_queryset(request.user, comment.stock, limit=None).get(pk=comment.id)
        return Response(present_comment(saved), status=201)


class CommentLikeView(APIView):
    def post(self, request, comment_id: int):
        comment = services.toggle_comment_like(request.user, comment_id)
        return Response(present_comment(comment))


class AiKeyView(APIView):
    permission_classes = [IsGroupAdmin]

    def get(self, request):
        from .risk import current_ai_api_key

        return Response({"api_key": current_ai_api_key()})

    def patch(self, request):
        key = str(request.data.get("api_key", "")).strip()
        if len(key) > 256:
            raise ValidationError("API Key 不能超过 256 个字符")
        row, _ = SiteSetting.objects.update_or_create(pk=1, defaults={"ai_api_key": key})
        return Response({"api_key": row.ai_api_key})


class RiskView(APIView):
    def get(self, request, code: str):
        report = services.risk_for(code, force=False)
        if report is None:
            from .risk import DISCLAIMER

            return Response(
                {
                    "summary": "还没有排查。公开标题会在这台设备上检索。",
                    "regulatory": "",
                    "negative_news": "",
                    "other_risks": [],
                    "checks": [],
                    "regulatory_status": "unknown",
                    "negative_status": "unknown",
                    "headlines": [],
                    "stance": "unknown",
                    "source": "pending",
                    "model": "",
                    "created_at": "",
                    "disclaimer": DISCLAIMER,
                }
            )
        return Response(present_risk(report))

    def post(self, request, code: str):
        report = services.risk_for(
            code,
            force=True,
            headlines=services.client_headlines(request.data.get("headlines")),
            quote_text=str(request.data.get("quote_text") or ""),
        )
        return Response(present_risk(report))
