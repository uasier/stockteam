import secrets

from django.contrib.auth import authenticate
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import InviteCode, User
from .serializers import InviteCreateSerializer, LoginSerializer, ProfileSerializer, RegisterSerializer

MAX_AVATAR_BYTES = 2 * 1024 * 1024

# 首位注册固定使用这个邀请码。用过即作废，不再另建内置管理员。
FOUNDER_INVITE = "ADMIN"
INVITE_ERROR = "邀请码不正确或已经使用"


def present_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "avatar": user.avatar_url(),
        "is_admin": user.is_admin,
    }


def present_invite(invite: InviteCode) -> dict:
    return {
        "id": invite.id,
        "code": invite.code,
        "note": invite.note,
        "created_at": invite.created_at.isoformat(),
        "used_at": invite.used_at.isoformat() if invite.used_at else None,
        "used_by": invite.used_by.username if invite.used_by_id else None,
    }


def _new_code() -> str:
    return secrets.token_hex(4).upper()


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = RegisterSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        user = (
            _register_founder(data)
            if data["invite_code"] == FOUNDER_INVITE
            else _register_with_invite(data)
        )
        if user is None:
            return Response({"error": INVITE_ERROR}, status=400)
        token = Token.objects.create(user=user)
        return Response({"token": token.key, "user": present_user(user)}, status=201)


def _register_founder(data: dict) -> User | None:
    """库里还没有用户时，ADMIN 注册为管理员。并发时靠邀请码唯一约束只放行一人。"""
    try:
        with transaction.atomic():
            if User.objects.exists():
                return None
            user = User.objects.create_user(
                username=data["username"],
                password=data["password"],
                is_staff=True,
                is_superuser=True,
            )
            InviteCode.objects.create(
                code=FOUNDER_INVITE,
                note="首位管理员",
                created_by=user,
                used_by=user,
                used_at=timezone.now(),
            )
            return user
    except IntegrityError:
        return None


def _register_with_invite(data: dict) -> User | None:
    with transaction.atomic():
        invite = (
            InviteCode.objects.select_for_update()
            .filter(code=data["invite_code"])
            .first()
        )
        if invite is None or invite.used_by_id:
            return None
        user = User.objects.create_user(
            username=data["username"],
            password=data["password"],
        )
        invite.used_by = user
        invite.used_at = timezone.now()
        invite.save(update_fields=["used_by", "used_at"])
        return user


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = LoginSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=payload.validated_data["username"].strip(),
            password=payload.validated_data["password"],
        )
        if user is None:
            return Response({"error": "账号或密码不正确"}, status=401)
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": present_user(user)})


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response({"ok": True})


class MeView(APIView):
    def get(self, request):
        return Response(present_user(request.user))

    def patch(self, request):
        payload = ProfileSerializer(data=request.data, context={"user": request.user})
        payload.is_valid(raise_exception=True)
        user = request.user
        user.username = payload.validated_data["username"]
        user.save(update_fields=["username"])
        return Response(present_user(user))


def _avatar_kind(upload) -> tuple[str, str]:
    head = upload.read(32)
    upload.seek(0)
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif", "image/gif"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp", "image/webp"
    raise ValidationError("头像请使用 PNG、JPG、GIF 或 WEBP")


class AvatarView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return super().get_permissions()

    def get(self, request, user_id: int):
        user = User.objects.filter(pk=user_id).first()
        if user is None or not user.avatar:
            raise NotFound("没有头像")
        ext = user.avatar.name.rsplit(".", 1)[-1].lower()
        content_type = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
        }.get(ext, "application/octet-stream")
        return FileResponse(user.avatar.open("rb"), content_type=content_type)

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError("请选择头像图片")
        data = upload.read()
        if len(data) > MAX_AVATAR_BYTES:
            raise ValidationError("头像不能超过 2MB")
        upload.seek(0)
        suffix, _content_type = _avatar_kind(upload)
        user = request.user
        if user.avatar:
            user.avatar.delete(save=False)
        user.avatar.save(f"{user.id}{suffix}", ContentFile(data), save=True)
        return Response(present_user(user))

    def delete(self, request):
        user = request.user
        if user.avatar:
            user.avatar.delete(save=True)
        return Response(present_user(user))


class IsGroupAdmin(BasePermission):
    message = "只有管理员可以生成邀请码"

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class InviteListView(APIView):
    permission_classes = [IsGroupAdmin]

    def get(self, request):
        invites = InviteCode.objects.select_related("used_by")[:100]
        return Response({"items": [present_invite(item) for item in invites]})

    def post(self, request):
        payload = InviteCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        count = payload.validated_data["count"]
        note = (payload.validated_data.get("note") or "").strip()
        created = []
        for _ in range(count):
            code = _new_code()
            while InviteCode.objects.filter(code=code).exists():
                code = _new_code()
            created.append(
                InviteCode.objects.create(code=code, note=note, created_by=request.user)
            )
        return Response({"items": [present_invite(item) for item in created]}, status=201)
