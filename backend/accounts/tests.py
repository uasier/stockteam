from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0"
    b"\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)

from accounts.models import InviteCode, User


class FounderRegisterTests(TestCase):
    def test_first_registration_with_admin_code_becomes_admin(self):
        client = APIClient()
        created = client.post(
            "/api/auth/register",
            {
                "username": "lin",
                "password": "pass-word-1",
                "invite_code": "admin",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.data["user"]["is_admin"])
        user = User.objects.get(username="lin")
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        invite = InviteCode.objects.get(code="ADMIN")
        self.assertEqual(invite.used_by_id, user.id)
        self.assertIsNotNone(invite.used_at)

        again = client.post(
            "/api/auth/register",
            {"username": "min", "password": "pass-word-1", "invite_code": "ADMIN"},
            format="json",
        )
        self.assertEqual(again.status_code, 400)
        self.assertFalse(User.objects.filter(username="min").exists())

    def test_empty_database_rejects_other_invite_codes(self):
        denied = APIClient().post(
            "/api/auth/register",
            {"username": "lin", "password": "pass-word-1", "invite_code": "NOPE"},
            format="json",
        )
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    def test_admin_code_stays_closed_when_any_user_already_exists(self):
        User.objects.create_user(username="old", password="pass-word-1")
        denied = APIClient().post(
            "/api/auth/register",
            {"username": "lin", "password": "pass-word-1", "invite_code": "ADMIN"},
            format="json",
        )
        self.assertEqual(denied.status_code, 400)
        self.assertFalse(User.objects.filter(username="lin").exists())


class AccountApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass-word-1", is_staff=True)
        self.invite = InviteCode.objects.create(code="ABCD1234", created_by=self.admin)

    def test_register_requires_a_fresh_invite(self):
        denied = self.client.post(
            "/api/auth/register",
            {"username": "lin", "password": "pass-word-1", "invite_code": "NOPE"},
            format="json",
        )
        self.assertEqual(denied.status_code, 400)

        created = self.client.post(
            "/api/auth/register",
            {
                "username": "lin",
                "password": "pass-word-1",
                "invite_code": "abcd1234",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["user"]["username"], "lin")
        self.assertFalse(created.data["user"]["is_admin"])

        reused = self.client.post(
            "/api/auth/register",
            {"username": "min", "password": "pass-word-1", "invite_code": "ABCD1234"},
            format="json",
        )
        self.assertEqual(reused.status_code, 400)

    def test_login_and_me(self):
        User.objects.create_user(username="lin", password="pass-word-1")
        bad = self.client.post(
            "/api/auth/login",
            {"username": "lin", "password": "wrong-pass"},
            format="json",
        )
        self.assertEqual(bad.status_code, 401)

        ok = self.client.post(
            "/api/auth/login",
            {"username": "lin", "password": "pass-word-1"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {ok.data['token']}")
        me = self.client.get("/api/auth/me")
        self.assertEqual(me.data["username"], "lin")
        self.assertEqual(me.data["avatar"], "")

    def test_user_can_edit_username_and_avatar(self):
        user = User.objects.create_user(username="lin", password="pass-word-1")
        other = User.objects.create_user(username="min", password="pass-word-1")
        token = Token.objects.create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

        taken = self.client.patch("/api/auth/me", {"username": "min"}, format="json")
        self.assertEqual(taken.status_code, 400)

        renamed = self.client.patch("/api/auth/me", {"username": "lin2"}, format="json")
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.data["username"], "lin2")
        user.refresh_from_db()
        self.assertEqual(user.username, "lin2")

        uploaded = self.client.post(
            "/api/auth/avatar",
            {"file": SimpleUploadedFile("face.png", PNG, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 200)
        self.assertEqual(uploaded.data["avatar"], f"/api/auth/avatar/{user.id}")
        image = self.client.get(uploaded.data["avatar"])
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image["Content-Type"], "image/png")

        rejected = self.client.post(
            "/api/auth/avatar",
            {"file": SimpleUploadedFile("note.txt", b"hello", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(rejected.status_code, 400)

        cleared = self.client.delete("/api/auth/avatar")
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.data["avatar"], "")
        self.assertEqual(other.username, "min")

    def test_only_admin_creates_invites(self):
        member = User.objects.create_user(username="lin", password="pass-word-1")
        token = Token.objects.create(user=member)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        denied = self.client.post("/api/auth/invites", {"count": 1}, format="json")
        self.assertEqual(denied.status_code, 403)

        admin_token = Token.objects.create(user=self.admin)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {admin_token.key}")
        created = self.client.post("/api/auth/invites", {"count": 2, "note": "朋友"}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(len(created.data["items"]), 2)
        self.assertEqual(created.data["items"][0]["note"], "朋友")
        listed = self.client.get("/api/auth/invites")
        self.assertGreaterEqual(len(listed.data["items"]), 2)
