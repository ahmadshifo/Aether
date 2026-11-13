"""Member 2: call Member 3's search and image APIs, or a schema-compatible mock while developing.

The multimedia service listens on this PC only (MULTIMEDIA_API_URL, default http://127.0.0.1:8003).
Failures raise MemoryUnavailable so /ask can still answer honestly ("I can't see the camera").
"""

import json
import os
import urllib.error
import urllib.request

TIMEOUT = 4.0


class MemoryUnavailable(RuntimeError):
    pass


def _base() -> str:
    return os.getenv("MULTIMEDIA_API_URL", "http://127.0.0.1:8003").rstrip("/").replace("//localhost:", "//127.0.0.1:")


def _post(path: str, body: dict, cookie: str | None = None) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if cookie:
        headers["Cookie"] = cookie  # Member 3's API checks the same login cookie and session ownership.
    request = urllib.request.Request(f"{_base()}{path}", data=json.dumps(body).encode(), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}  # session not registered to this account (or nothing there): no evidence, not an outage
        raise MemoryUnavailable(f"multimedia {path} answered {error.code}") from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise MemoryUnavailable(f"multimedia {path} failed: {type(error).__name__}") from None


def _get(path: str, cookie: str | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{_base()}{path}", headers=headers), timeout=TIMEOUT) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}
        raise MemoryUnavailable(f"multimedia {path} answered {error.code}") from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise MemoryUnavailable(f"multimedia {path} failed: {type(error).__name__}") from None


class MemoryClient:
    def __init__(self, cookie: str | None = None):
        self.cookie = cookie  # the signed-in user's login cookie, forwarded as-is

    def search(self, session_id: str, query: str, mode: str, limit: int) -> list[dict]:
        """SearchFrame dicts, best first. Empty means nothing matched."""
        return _post("/api/v1/search", {"session_id": session_id, "query": query, "mode": mode, "limit": limit},
                     self.cookie).get("frames", [])

    def keep(self, session_id: str, frame_ids: list[str]) -> dict:
        """Ask multimedia to save the frames an answer used. Returns {accepted, missing}."""
        return _post("/api/v1/frames/keep", {"session_id": session_id, "frame_ids": frame_ids}, self.cookie)

    def live_state(self, session_id: str) -> dict:
        """How the live camera is doing: last_frame_at, dark_since, frozen_since (ISO times or None)."""
        return _get(f"/api/v1/live/state?session_id={session_id}", self.cookie)
