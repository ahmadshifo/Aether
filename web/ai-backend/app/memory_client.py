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


def _post(path: str, body: dict) -> dict:
    request = urllib.request.Request(f"{_base()}{path}", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise MemoryUnavailable(f"multimedia {path} failed: {type(error).__name__}") from None


class MemoryClient:
    def search(self, session_id: str, query: str, mode: str, limit: int) -> list[dict]:
        """SearchFrame dicts, best first. Empty means nothing matched."""
        return _post("/api/v1/search", {"session_id": session_id, "query": query, "mode": mode, "limit": limit}).get("frames", [])

    def keep(self, session_id: str, frame_ids: list[str]) -> dict:
        """Ask multimedia to save the frames an answer used. Returns {accepted, missing}."""
        return _post("/api/v1/frames/keep", {"session_id": session_id, "frame_ids": frame_ids})
