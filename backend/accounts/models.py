from django.contrib.auth.models import AbstractUser
from django.db import models


def _avatar_upload(instance, filename: str) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "img"
    return f"avatars/{instance.id}.{suffix}"


class User(AbstractUser):
    avatar = models.FileField("头像", upload_to=_avatar_upload, blank=True)

    @property
    def is_admin(self) -> bool:
        return bool(self.is_staff)

    def avatar_url(self) -> str:
        if not self.avatar:
            return ""
        return f"/api/auth/avatar/{self.id}"


class InviteCode(models.Model):
    code = models.CharField("邀请码", max_length=12, unique=True)
    note = models.CharField("备注", max_length=80, blank=True)
    created_by = models.ForeignKey(
        User, verbose_name="创建人", related_name="invites_created", on_delete=models.PROTECT
    )
    used_by = models.ForeignKey(
        User,
        verbose_name="使用人",
        related_name="invite_used",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    used_at = models.DateTimeField("使用时间", null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "邀请码"
        verbose_name_plural = "邀请码"

    def __str__(self) -> str:
        return self.code
