"""Member 2: links the phone's live stream to the signed-in account, so the dashboard's Connect finds it without a link.

The phone and the web dashboard log in with the same account. The phone reports Start/Stop here; the dashboard asks
for this account's live session and plays live/<session_id> from MediaMTX.
"""

import uuid
from contextlib import closing
from datetime import timedelta

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id

router = APIRouter(prefix="/api/v1/streams", tags=["streams"])


class StreamRequest(BaseModel):
    session_id: str


def _session_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError(400, "invalid_session_id", "session_id must be a UUID.") from None


@router.post("/start")
def start(body: StreamRequest, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The phone pressed Start: this account is now publishing live/<session_id>."""
    session_id = _session_id(body.session_id)
    now = _now()
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT user_id FROM sessions WHERE session_id = %s", (session_id,))
        row = cur.fetchone()
        if row and row["user_id"] not in (None, user_id):
            raise ApiError(409, "session_taken", "This session belongs to another account.")
        # One live stream per account: an earlier one whose Stop never arrived is closed now.
        cur.execute(
            "UPDATE sessions SET status = 'ended', ended_at = %s WHERE user_id = %s AND status = 'live' AND session_id <> %s",
            (now, user_id, session_id),
        )
        cur.execute(
            "INSERT INTO sessions (session_id, user_id, status, started_at) VALUES (%s, %s, 'live', %s) "
            "ON DUPLICATE KEY UPDATE user_id = %s, status = 'live', ended_at = NULL",
            (session_id, user_id, now, user_id),
        )
    return {"session": {"session_id": session_id, "started_at": _iso(now)}}


@router.post("/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop(body: StreamRequest, user_id: str = Depends(signed_in_user_id)) -> None:
    """The phone pressed Stop (or closed the camera)."""
    session_id = _session_id(body.session_id)
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE sessions SET status = 'ended', ended_at = %s WHERE session_id = %s AND user_id = %s AND status = 'live'",
            (_now(), session_id, user_id),
        )


@router.get("/recent")
def recent(user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's camera sessions from the last 24 hours (as long as saved frames are kept), newest first."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT session_id, status, started_at, ended_at FROM sessions WHERE user_id = %s AND started_at >= %s "
            "ORDER BY started_at DESC LIMIT 50",
            (user_id, _now() - timedelta(hours=24)),
        )
        rows = cur.fetchall()
    return {"sessions": [{"session_id": row["session_id"], "status": row["status"], "started_at": _iso(row["started_at"]),
                          "ended_at": _iso(row["ended_at"]) if row["ended_at"] else None} for row in rows]}


@router.get("/active")
def active(user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's newest live stream, or {"session": null} when the phone isn't streaming."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT session_id, started_at FROM sessions WHERE user_id = %s AND status = 'live' "
            "ORDER BY started_at DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return {"session": None}
    # camera_paused: the user said "camera off", so the dashboard shows that instead of a stream error.
    from app.safety import camera_paused
    return {"session": {"session_id": row["session_id"], "started_at": _iso(row["started_at"]),
                        "camera_paused": camera_paused(row["session_id"])}}
