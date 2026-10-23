from django.conf import settings
from django.db import models


class Stock(models.Model):
    code = models.CharField("代码", max_length=6, unique=True)
    name = models.CharField("名称", max_length=64, blank=True)
    price = models.DecimalField("现价", max_digits=12, decimal_places=3, null=True, blank=True)
    change_pct = models.DecimalField("涨跌幅", max_digits=8, decimal_places=3, null=True, blank=True)
    open_price = models.DecimalField("今开", max_digits=12, decimal_places=3, null=True, blank=True)
    high = models.DecimalField("最高", max_digits=12, decimal_places=3, null=True, blank=True)
    low = models.DecimalField("最低", max_digits=12, decimal_places=3, null=True, blank=True)
    prev_close = models.DecimalField("昨收", max_digits=12, decimal_places=3, null=True, blank=True)
    quoted_at = models.DateTimeField("行情时间", null=True, blank=True)

    class Meta:
        verbose_name = "股票"
        verbose_name_plural = "股票"

    def __str__(self) -> str:
        return f"{self.name or self.code} {self.code}"


class Tag(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="stock_tags", on_delete=models.CASCADE)
    name = models.CharField("标签", max_length=8)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "name"], name="uniq_user_tag"),
        ]
        verbose_name = "标签"
        verbose_name_plural = "标签"

    def __str__(self) -> str:
        return self.name


class WatchItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="watch_items", on_delete=models.CASCADE)
    stock = models.ForeignKey(Stock, related_name="watchers", on_delete=models.CASCADE)
    custom_price = models.DecimalField("自选价格", max_digits=12, decimal_places=3, null=True, blank=True)
    custom_date = models.DateField("自选日期")
    note = models.CharField("备注", max_length=200, blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name="watches")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "stock"], name="uniq_user_watch"),
        ]
        ordering = ["-custom_date", "-id"]
        verbose_name = "观察"
        verbose_name_plural = "观察"


class Holding(models.Model):
    OPEN = "open"
    CLOSED = "closed"
    STATUS = [(OPEN, "持仓"), (CLOSED, "已卖出")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="holdings", on_delete=models.CASCADE)
    stock = models.ForeignKey(Stock, related_name="holdings", on_delete=models.CASCADE)
    cost_price = models.DecimalField("成本", max_digits=12, decimal_places=3)
    quantity = models.DecimalField("数量", max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=8, choices=STATUS, default=OPEN)
    sell_price = models.DecimalField("卖出价", max_digits=12, decimal_places=3, null=True, blank=True)
    opened_at = models.DateTimeField("买入时间", auto_now_add=True)
    closed_at = models.DateTimeField("卖出时间", null=True, blank=True)
    note = models.CharField("备注", max_length=200, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "stock"],
                condition=models.Q(status="open"),
                name="uniq_open_holding",
            )
        ]
        ordering = ["-id"]
        verbose_name = "持仓"
        verbose_name_plural = "持仓"


class Activity(models.Model):
    BUY = "buy"
    SELL = "sell"
    WATCH = "watch"
    UNWATCH = "unwatch"
    WATCH_EDIT = "watch_edit"
    LIKE = "like"
    UNLIKE = "unlike"
    COMMENT = "comment"
    COMMENT_LIKE = "comment_like"
    COMMENT_UNLIKE = "comment_unlike"
    KIND = [
        (BUY, "买入"),
        (SELL, "卖出"),
        (WATCH, "加入观察"),
        (UNWATCH, "移出观察"),
        (WATCH_EDIT, "更新自选"),
        (LIKE, "关注"),
        (UNLIKE, "取消关注"),
        (COMMENT, "评论"),
        (COMMENT_LIKE, "评论加一"),
        (COMMENT_UNLIKE, "取消评论加一"),
    ]
    TRADABLE = {BUY, SELL}

    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="activities", on_delete=models.CASCADE)
    stock = models.ForeignKey(Stock, related_name="activities", on_delete=models.CASCADE)
    holding = models.ForeignKey(Holding, related_name="activities", null=True, on_delete=models.SET_NULL)
    source = models.ForeignKey(
        "self", related_name="follows", null=True, blank=True, on_delete=models.SET_NULL
    )
    kind = models.CharField(max_length=16, choices=KIND)
    price = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "动态"
        verbose_name_plural = "动态"


class StockLike(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="stock_likes", on_delete=models.CASCADE)
    stock = models.ForeignKey(Stock, related_name="likes", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "stock"], name="uniq_stock_like"),
        ]


class Comment(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="comments", on_delete=models.CASCADE)
    stock = models.ForeignKey(Stock, related_name="comments", on_delete=models.CASCADE)
    body = models.CharField("内容", max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "评论"
        verbose_name_plural = "评论"


class CommentLike(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="comment_likes", on_delete=models.CASCADE)
    comment = models.ForeignKey(Comment, related_name="likes", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "comment"], name="uniq_comment_like"),
        ]


class SiteSetting(models.Model):
    """全站只有一行。管理员在这里保存 DeepSeek API Key。"""

    ai_api_key = models.CharField("DeepSeek API Key", max_length=256, blank=True)

    class Meta:
        verbose_name = "站点设置"
        verbose_name_plural = "站点设置"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)


class RiskReport(models.Model):
    stock = models.ForeignKey(Stock, related_name="reports", on_delete=models.CASCADE)
    summary = models.TextField()
    regulatory = models.TextField()
    negative_news = models.TextField()
    other_risks = models.JSONField(default=list)
    checks = models.JSONField("排查清单", default=list)
    headlines = models.JSONField(default=list)
    stance = models.CharField(max_length=16, default="unknown")
    source = models.CharField(max_length=16)
    model = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "风险备忘"
        verbose_name_plural = "风险备忘"
