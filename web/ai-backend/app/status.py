"""Member 2: GET /api/v1/status aggregates streaming, multimedia and AI health for the dashboard.

Each value is a ServiceStatus (online | connecting | offline | error), checked live:
- streaming:  MediaMTX's local API answers (or, with the API off, its WebRTC port is open).
- multimedia: Member 3's /health answers; its own "error" (e.g. storage down) is passed on.
- ai:         this backend is running; "offline" while OPENAI_API_KEY is missing, since no answer
              can be generated without it.
`details` explains each value in a sentence; `live_session` is the signed-in account's live phone
session (and whether its stream is actually reaching MediaMTX), or null.
"""

import json
import os
import socket
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from urllib.parse import urlparse

from fastapi import APIRouter, Depends

from app.auth import _connect, _iso, signed_in_user_id

router = APIRouter(prefix="/api/v1", tags=["status"])
TIMEOUT = 1.0  # every check is on this PC; anything slower counts as down


def _get_json(url: str):
    with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
        return json.load(response)


def _port_open(url: str) -> bool:
    parsed = urlparse(url)
    try:
        with socket.create_connection((parsed.hostname or "127.0.0.1", parsed.port or 80), timeout=TIMEOUT):
            return True
    except OSError:
        return False


def _ready_paths():
    api = os.getenv("MEDIAMTX_API_URL", "http://127.0.0.1:9997").rstrip("/")
    try:
        items = _get_json(f"{api}/v3/paths/list?itemsPerPage=1000").get("items") or []
        return {str(item.get("name", "")) for item in items if item.get("ready")}
    except Exception:
        return None


def check_streaming(pool) -> tuple[str, str, set[str] | None]:
    # Both probes run at once: on Windows a refused local port still waits for the timeout.
    paths_job = pool.submit(_ready_paths)
    port_job = pool.submit(_port_open, os.getenv("MEDIAMTX_WEBRTC_URL", "http://127.0.0.1:8889"))
    ready = paths_job.result()
    if ready is not None:
        return "online", "The video server is running.", ready
    if port_job.result():
        return "online", "The video server is running (its stream list is off).", None
    return "offline", "The video server (MediaMTX) is not running.", None


def check_multimedia() -> tuple[str, str]:
    base = os.getenv("MULTIMEDIA_API_URL", "http://127.0.0.1:8003").rstrip("/").replace("//localhost:", "//127.0.0.1:")
    try:
        health = _get_json(f"{base}/health")
    except Exception:
        return "offline", "The memory service is not running."
    if health.get("status") in ("ok", "online"):
        return "online", "The memory service is running."
    return "error", "The memory service answered, but reports a problem."


def check_ai() -> tuple[str, str]:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        return "offline", "No OpenAI key yet, so the assistant can't answer questions."
    return "online", "The assistant is ready."


def _live_session(user_id: str):
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT session_id, started_at FROM sessions WHERE user_id = %s AND status = 'live' "
                    "ORDER BY started_at DESC LIMIT 1", (user_id,))
        return cur.fetchone()


@router.get("/status")
def status(user_id: str = Depends(signed_in_user_id)) -> dict:
    with ThreadPoolExecutor(max_workers=3) as pool:
        multimedia_job = pool.submit(check_multimedia)
        streaming, streaming_detail, ready_paths = check_streaming(pool)
        multimedia, multimedia_detail = multimedia_job.result()
    ai, ai_detail = check_ai()
    row = _live_session(user_id)
    live = None
    if row:
        reaching = None if ready_paths is None else f"live/{row['session_id']}" in ready_paths
        live = {"session_id": row["session_id"], "started_at": _iso(row["started_at"]), "streaming": reaching}
    return {
        "streaming": streaming, "multimedia": multimedia, "ai": ai,
        "details": {"streaming": streaming_detail, "multimedia": multimedia_detail, "ai": ai_detail},
        "live_session": live,
    }
