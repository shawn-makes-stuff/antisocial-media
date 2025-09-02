"""Authentication helpers for session management and admin checks."""
from __future__ import annotations

import os
from typing import Optional

from flask import Request, session

from storage import load_users

ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "changeme")  # set real value in env!


def current_user() -> Optional[dict]:
    uid = session.get("uid")
    if not uid:
        return None
    for user in load_users():
        if user.get("id") == uid:
            return user
    return None


def require_admin(req: Request) -> bool:
    user = current_user()
    if user and user.get("is_admin"):
        return True
    secret = req.headers.get("X-Admin-Secret") or req.args.get("key")
    return secret == ADMIN_SECRET
