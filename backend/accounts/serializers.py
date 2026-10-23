import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fff]{2,20}$")


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)
    invite_code = serializers.CharField()

    def validate_username(self, value: str) -> str:
        username = value.strip()
        if not USERNAME_RE.match(username):
            raise serializers.ValidationError("用户名用 2 到 20 位字母、数字或中文")
        if User.objects.filter(username=username).exists():
            raise serializers.ValidationError("这个用户名已经有人用了")
        return username

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError("密码至少 8 位，且不能全是数字或过于常见") from exc
        return value

    def validate_invite_code(self, value: str) -> str:
        return value.strip().upper()


class ProfileSerializer(serializers.Serializer):
    username = serializers.CharField()

    def validate_username(self, value: str) -> str:
        username = value.strip()
        if not USERNAME_RE.match(username):
            raise serializers.ValidationError("用户名用 2 到 20 位字母、数字或中文")
        user = self.context["user"]
        if User.objects.exclude(pk=user.pk).filter(username=username).exists():
            raise serializers.ValidationError("这个用户名已经有人用了")
        return username


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


class InviteCreateSerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=1, max_value=20, required=False, default=1)
    note = serializers.CharField(required=False, allow_blank=True, max_length=80)
