from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import InviteCode, User


@admin.register(User)
class CircleUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + ((None, {"fields": ("avatar",)}),)
    list_display = ("username", "is_staff", "is_active")


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "created_by", "used_by", "created_at", "used_at")
    search_fields = ("code",)
