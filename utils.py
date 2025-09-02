"""Utility functions for JSON handling and content detection."""
import json
import os
import re
import tempfile
from typing import Any, Dict, List, Optional

YOUTUBE_PATTERNS = [
    r"(?:https?://)?(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_\-]{6,})",
    r"(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_\-]{6,})",
]


def load_json(path: str, default: Any) -> Any:
    """Load JSON data from *path* or return *default* if the file is missing."""
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def atomic_write(path: str, data_obj: Any) -> None:
    """Atomically write *data_obj* as JSON to *path*."""
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(path), prefix=".tmp-", suffix=".json"
    )
    with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
        json.dump(data_obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def find_comment(comments: List[Dict[str, Any]], cid: str) -> Optional[Dict[str, Any]]:
    """Recursively search *comments* for a comment with id *cid*."""
    for comment in comments:
        if comment.get("id") == cid:
            return comment
        found = find_comment(comment.get("replies", []), cid)
        if found:
            return found
    return None


def is_youtube(url: str) -> Optional[str]:
    """Return the YouTube video ID if *url* is a YouTube link."""
    for pattern in YOUTUBE_PATTERNS:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None
