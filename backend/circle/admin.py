from django.contrib import admin

from .models import Activity, Comment, Holding, RiskReport, Stock, WatchItem


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "price", "change_pct", "quoted_at")
    search_fields = ("code", "name")


admin.site.register(WatchItem)
admin.site.register(Holding)
admin.site.register(Activity)
admin.site.register(Comment)
admin.site.register(RiskReport)
