from django.urls import path

from .views import AvatarView, InviteListView, LoginView, LogoutView, MeView, RegisterView

urlpatterns = [
    path("register", RegisterView.as_view()),
    path("login", LoginView.as_view()),
    path("logout", LogoutView.as_view()),
    path("me", MeView.as_view()),
    path("avatar", AvatarView.as_view()),
    path("avatar/<int:user_id>", AvatarView.as_view()),
    path("invites", InviteListView.as_view()),
]
