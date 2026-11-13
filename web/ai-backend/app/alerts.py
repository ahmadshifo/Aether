"""Member 2: GET /api/v1/alerts - problems with the live camera that a caregiver should know about right now.

The dashboard shows these as a banner on every page (SOS alerts have their own red banner, see app/safety.py):
- camera_dark:        the picture has been almost black for a while (lens covered, phone face down or in a pocket)
- camera_frozen:      the picture hasn't changed at all for a while (the video froze)
- no_picture:         the phone says it's streaming, but no pictures are arriving
- phone_disconnected: the phone's video isn't reaching the video server (Wi-Fi or app problem)
- memory_offline:     the memory service is down, so the assistant can't see the camera to answer

Alerts are worked out live on each request, so each one disappears by itself once the problem is gone.
Nothing is shown while the user has said "camera off" (that is on purpose, not a problem) or isn't streaming.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from app.auth import _iso, _now, signed_in_user_id
from app.memory_client import MemoryClient, MemoryUnavailable
from app.safety import camera_paused
from app.status import _live_session, check_multimedia, check_streaming

router = APIRouter(prefix="/api/v1", tags=["alerts"])

# How long a problem must last before it is shown, so a hand passing over the lens doesn't raise an alert.
PROBLEM_SECONDS = 10
# A new session gets this long to send its first pictures before "no picture" is shown.
STARTUP_SECONDS = 15

TEXT = {
    "camera_dark": ("The camera sees almost nothing",
                    "The picture has been dark for a while. The lens may be covered or the phone may be in a pocket."),
    "camera_frozen": ("The camera picture is frozen",
                      "The picture hasn't changed. The phone's camera may have stopped; restarting the session usually helps."),
    "no_picture": ("No pictures from the phone",
                   "The session is on, but no pictures are arriving. The phone may have lost its connection."),
    "phone_disconnected": ("The phone's video isn't arriving",
                           "The session is on, but its video isn't reaching the video server. Check the phone's Wi-Fi."),
    "memory_offline": ("The assistant can't see the camera",
                       "The memory service is not running, so questions can't be answered from the camera."),
}


def _parse(value: str | None) -> datetime | None:
    """ISO time from the multimedia service -> naive UTC, like the database's times."""
    if not value:
        return None
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment


def _make(kind: str, session_id: str, since: datetime, level: str = "warning") -> dict:
    title, detail = TEXT[kind]
    # The id changes when a new problem starts, so a caregiver who pressed "Seen" still sees the next one.
    return {"alert_id": f"{kind}:{session_id}:{_iso(since)}", "kind": kind, "level": level,
            "title": title, "detail": detail, "since": _iso(since), "session_id": session_id}


def build_alerts(now: datetime, session: dict | None, paused: bool, reaching: bool | None,
                 memory_online: bool, state: dict | None) -> list[dict]:
    """The rules, kept apart from the network so they can be tested.

    session: {"session_id", "started_at"} of the live session or None; reaching: whether its video reaches the
    video server (None when unknown); state: the memory service's live state (times as ISO strings)."""
    if not session or paused:
        return []
    session_id, started = session["session_id"], session["started_at"]
    settled = now - started >= timedelta(seconds=STARTUP_SECONDS)
    problem_start = now - timedelta(seconds=PROBLEM_SECONDS)
    alerts = []
    if not memory_online:
        alerts.append(_make("memory_offline", session_id, started))
    if reaching is False and settled:
        # The video itself is missing, so "no picture", "dark" or "frozen" would only repeat the same problem.
        return [_make("phone_disconnected", session_id, started, "danger"), *alerts]
    if not memory_online or state is None:
        return alerts
    last = _parse(state.get("last_frame_at"))
    if settled and (last is None or last < now - timedelta(seconds=STARTUP_SECONDS)):
        return [_make("no_picture", session_id, last or started, "danger"), *alerts]
    dark = _parse(state.get("dark_since"))
    if dark and dark <= problem_start:
        alerts.append(_make("camera_dark", session_id, dark))
    frozen = _parse(state.get("frozen_since"))
    if frozen and frozen <= problem_start:
        alerts.append(_make("camera_frozen", session_id, frozen))
    return alerts


@router.get("/alerts")
def alerts(request: Request, user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's live problems, most urgent first. Empty when everything is fine."""
    row = _live_session(user_id)
    if not row or camera_paused(row["session_id"]):
        return {"alerts": []}
    session = {"session_id": row["session_id"], "started_at": row["started_at"]}
    with ThreadPoolExecutor(max_workers=3) as pool:
        multimedia_job = pool.submit(check_multimedia)
        _, _, ready_paths = check_streaming(pool)
        memory_online = multimedia_job.result()[0] == "online"
    reaching = None if ready_paths is None else f"live/{row['session_id']}" in ready_paths
    state = None
    if memory_online:
        try:
            state = MemoryClient(request.headers.get("cookie")).live_state(row["session_id"])
        except MemoryUnavailable:
            memory_online = False
    found = build_alerts(_now(), session, False, reaching, memory_online, state)
    found.sort(key=lambda alert: alert["level"] != "danger")
    return {"alerts": found}
