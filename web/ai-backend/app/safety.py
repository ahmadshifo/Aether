"""Member 2: safety features - the account's SOS phone number, SOS alerts, and "camera off" by voice.

How they fit together:
- The caregiver saves an SOS number on the dashboard's Profile page (GET/PUT /api/v1/settings).
- When the user says "I need help" or "SOS", the phone sends POST /api/v1/sos. The latest camera frames are
  kept as evidence, the dashboard shows a red alert until someone presses "I'm on it"
  (POST /api/v1/sos/{alert_id}/ack), and the phone then calls the SOS number it got back.
- "Camera off" / "camera on" by voice pauses only the camera; the phone reports it with
  POST /api/v1/streams/camera so the dashboard shows "Camera paused by the user" instead of an error.

Each account only ever sees its own settings, alerts and sessions.
"""

import json
import logging
import re
import uuid
from contextlib import closing
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id
from app.memory_client import MemoryClient, MemoryUnavailable

router = APIRouter(prefix="/api/v1", tags=["safety"])
log = logging.getLogger("ai.safety")

SETTINGS_TABLE = """CREATE TABLE IF NOT EXISTS user_settings (
    user_id     CHAR(36)    NOT NULL PRIMARY KEY,
    sos_number  VARCHAR(20) NULL,
    updated_at  DATETIME(3) NOT NULL,
    CONSTRAINT user_settings_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
SOS_TABLE = """CREATE TABLE IF NOT EXISTS sos_alerts (
    alert_id           CHAR(36)    NOT NULL PRIMARY KEY,
    user_id            CHAR(36)    NOT NULL,
    session_id         CHAR(36)    NULL,
    created_at         DATETIME(3) NOT NULL,
    acknowledged_at    DATETIME(3) NULL,
    evidence_frame_ids JSON        NOT NULL,
    INDEX sos_alerts_user_time_idx (user_id, created_at),
    CONSTRAINT sos_alerts_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
CAMERA_TABLE = """CREATE TABLE IF NOT EXISTS camera_state (
    session_id  CHAR(36)    NOT NULL PRIMARY KEY,
    user_id     CHAR(36)    NOT NULL,
    paused      BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  DATETIME(3) NOT NULL,
    CONSTRAINT camera_state_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""

# How far back the dashboard lists SOS alerts (the same 24 hours as everything else Aether keeps).
SOS_WINDOW = timedelta(hours=24)
# A phone number as people type it: an optional + then 3 to 15 digits, ignoring spaces, dashes,
# dots and brackets. Short numbers (like 112 or 140) are allowed on purpose.
PHONE = re.compile(r"^\+?\d{3,15}$")


def init_safety_tables() -> None:
    """Creates the three tables on startup if they don't exist yet (never drops or changes data)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        for statement in (SETTINGS_TABLE, SOS_TABLE, CAMERA_TABLE):
            cur.execute(statement)


def clean_phone_number(value: str | None) -> str | None:
    """The number as it should be dialled ("+961 3-123 456" -> "+9613123456"), None for empty, or ApiError."""
    if value is None or not value.strip():
        return None
    number = re.sub(r"[\s\-().]", "", value)
    if not PHONE.match(number):
        raise ApiError(422, "invalid_sos_number", "Enter a phone number of 3 to 15 digits, optionally starting with +.")
    return number


def _uuid(value: str, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ApiError(400, f"invalid_{field}", f"{field} must be a UUID.") from None


def _owned_session(cur, session_id: str, user_id: str) -> None:
    """Refuses a session that belongs to another account (an unknown session is allowed: it may not be registered yet)."""
    cur.execute("SELECT user_id FROM sessions WHERE session_id = %s", (session_id,))
    row = cur.fetchone()
    if row and row["user_id"] not in (None, user_id):
        raise ApiError(403, "session_not_yours", "This camera session belongs to another account.")


# ---------- SOS number ----------

class SettingsBody(BaseModel):
    sos_number: str | None = None


def get_sos_number(user_id: str) -> str | None:
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT sos_number FROM user_settings WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    return row["sos_number"] if row else None


@router.get("/settings")
def read_settings(user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's settings: for now only the SOS phone number (null when none is saved)."""
    return {"sos_number": get_sos_number(user_id)}


@router.put("/settings")
def save_settings(body: SettingsBody, user_id: str = Depends(signed_in_user_id)) -> dict:
    """Saves (or clears, when empty) the SOS phone number the phone calls after an SOS."""
    number = clean_phone_number(body.sos_number)
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO user_settings (user_id, sos_number, updated_at) VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE sos_number = VALUES(sos_number), updated_at = VALUES(updated_at)",
            (user_id, number, _now()),
        )
    return {"sos_number": number}


# ---------- SOS alerts ----------

class SosBody(BaseModel):
    session_id: str | None = None


def _alert(row: dict) -> dict:
    evidence = row["evidence_frame_ids"]
    return {"alert_id": row["alert_id"], "session_id": row["session_id"], "created_at": _iso(row["created_at"]),
            "acknowledged_at": _iso(row["acknowledged_at"]) if row["acknowledged_at"] else None,
            "evidence_frame_ids": json.loads(evidence) if isinstance(evidence, str) else list(evidence)}


def _keep_latest_frames(memory: MemoryClient, session_id: str) -> list[str]:
    """The newest camera frames of the session, kept so they survive the 2-minute memory. Never blocks the alert."""
    try:
        frames = memory.search(session_id, "help", "latest", 3)
        ids = [frame["frame_id"] for frame in frames]
        if ids:
            memory.keep(session_id, ids)
        return ids
    except (MemoryUnavailable, KeyError) as error:
        log.warning("SOS without frames: %s", error)
        return []


@router.post("/sos", status_code=201)
def send_sos(body: SosBody, request: Request, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The user asked for help by voice. Saves the alert with the latest frames and returns the number to call."""
    session_id = _uuid(body.session_id, "session_id") if body.session_id else None
    if session_id:
        with closing(_connect()) as conn, conn.cursor() as cur:
            _owned_session(cur, session_id, user_id)
    evidence = _keep_latest_frames(MemoryClient(request.headers.get("cookie")), session_id) if session_id else []
    alert_id, now = str(uuid.uuid4()), _now()
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sos_alerts (alert_id, user_id, session_id, created_at, evidence_frame_ids) VALUES (%s, %s, %s, %s, %s)",
            (alert_id, user_id, session_id, now, json.dumps(evidence)),
        )
    log.warning("SOS from account %s (session %s)", user_id, session_id)
    return {"alert_id": alert_id, "created_at": _iso(now), "sos_number": get_sos_number(user_id),
            "evidence_frame_ids": evidence}


@router.get("/sos")
def list_sos(user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's SOS alerts from the last 24 hours, unacknowledged first, then newest first."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM sos_alerts WHERE user_id = %s AND created_at >= %s "
            "ORDER BY acknowledged_at IS NOT NULL, created_at DESC LIMIT 50",
            (user_id, _now() - SOS_WINDOW),
        )
        rows = cur.fetchall()
    return {"alerts": [_alert(row) for row in rows]}


@router.post("/sos/{alert_id}/ack")
def acknowledge_sos(alert_id: str, user_id: str = Depends(signed_in_user_id)) -> dict:
    """A caregiver pressed "I'm on it": the alert stops ringing on every dashboard of this account."""
    alert_id = _uuid(alert_id, "alert_id")
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE sos_alerts SET acknowledged_at = COALESCE(acknowledged_at, %s) WHERE alert_id = %s AND user_id = %s",
                    (_now(), alert_id, user_id))
        cur.execute("SELECT * FROM sos_alerts WHERE alert_id = %s AND user_id = %s", (alert_id, user_id))
        row = cur.fetchone()
    if not row:
        raise ApiError(404, "not_found", "SOS alert not found.")
    return _alert(row)


# ---------- camera off / on ----------

class CameraBody(BaseModel):
    session_id: str
    paused: bool


@router.post("/streams/camera")
def set_camera(body: CameraBody, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The user said "camera off" or "camera on": remembered per session so the dashboard can say so."""
    session_id = _uuid(body.session_id, "session_id")
    with closing(_connect()) as conn, conn.cursor() as cur:
        _owned_session(cur, session_id, user_id)
        cur.execute(
            "INSERT INTO camera_state (session_id, user_id, paused, updated_at) VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE paused = VALUES(paused), updated_at = VALUES(updated_at)",
            (session_id, user_id, body.paused, _now()),
        )
    return {"session_id": session_id, "paused": body.paused}


def camera_paused(session_id: str) -> bool:
    """True when the user turned the camera off by voice in this session."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT paused FROM camera_state WHERE session_id = %s", (session_id,))
        row = cur.fetchone()
    return bool(row and row["paused"])
