"""Data storage helpers for posts, users and site metadata."""
from __future__ import annotations

from typing import Any, Dict, List

from utils import load_json, atomic_write

POSTS_FILE = "posts/posts.json"
SITE_FILE = "posts/site.json"
USERS_FILE = "users/users.json"


def load_posts() -> List[Dict[str, Any]]:
    data = load_json(POSTS_FILE, {"posts": []})
    posts = data.get("posts", [])
    return sorted(posts, key=lambda p: p.get("date", ""), reverse=True)


def save_posts(posts: List[Dict[str, Any]]) -> None:
    atomic_write(POSTS_FILE, {"posts": posts})


def load_site() -> Dict[str, Any]:
    return load_json(
        SITE_FILE,
        {"title": "Antisocial", "logo": None, "favicon": None, "tab_text": "Antisocial"},
    )


def save_site(site: Dict[str, Any]) -> None:
    atomic_write(SITE_FILE, site)


def load_users() -> List[Dict[str, Any]]:
    data = load_json(USERS_FILE, {"users": []})
    return data.get("users", [])


def save_users(users: List[Dict[str, Any]]) -> None:
    atomic_write(USERS_FILE, {"users": users})
