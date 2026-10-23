from django.urls import path

from .views import (
    CommentLikeView,
    CommentListView,
    FeedView,
    FollowView,
    HoldingListView,
    HoldingSellView,
    QuoteView,
    AiKeyView,
    RiskView,
    SearchView,
    StockDetailView,
    StockLikeView,
    StockTimelineView,
    WatchDetailView,
    WatchListView,
)

urlpatterns = [
    path("stocks/search", SearchView.as_view()),
    path("quotes", QuoteView.as_view()),
    path("watch", WatchListView.as_view()),
    path("watch/<int:item_id>", WatchDetailView.as_view()),
    path("holdings", HoldingListView.as_view()),
    path("holdings/<int:item_id>/sell", HoldingSellView.as_view()),
    path("feed", FeedView.as_view()),
    path("feed/<int:activity_id>/follow", FollowView.as_view()),
    path("stocks/<str:code>", StockDetailView.as_view()),
    path("stocks/<str:code>/timeline", StockTimelineView.as_view()),
    path("stocks/<str:code>/like", StockLikeView.as_view()),
    path("stocks/<str:code>/comments", CommentListView.as_view()),
    path("comments/<int:comment_id>/like", CommentLikeView.as_view()),
    path("stocks/<str:code>/risk", RiskView.as_view()),
    path("ai-key", AiKeyView.as_view()),
]
