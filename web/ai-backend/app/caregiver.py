"""Member 2: what the caregiver sees of the phone, and what they can send to it.

- Battery: during a session the phone reports its battery level and whether it is charging
  (POST /api/v1/device); the dashboard shows it next to the live camera (GET /api/v1/device), and a low
  battery becomes a camera alert (app/alerts.py).
Legacy note rows are preserved; text messaging endpoints have been retired.
"""

import uuid
from contextlib import closing
from datetime import timedelta

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id

router = APIRouter(prefix="/api/v1", tags=["caregiver"])

DEVICE_TABLE = """CREATE TABLE IF NOT EXISTS device_status (
    user_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin    NOT NULL PRIMARY KEY,
    session_id  CHAR(36)    NULL,
    battery     TINYINT     NOT NULL,
    charging    BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  DATETIME(3) NOT NULL,
    CONSTRAINT device_status_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
NOTES_TABLE = """CREATE TABLE IF NOT EXISTS caregiver_notes (
    note_id     CHAR(36)     NOT NULL PRIMARY KEY,
    user_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin     NOT NULL,
    text        VARCHAR(300) NOT NULL,
    created_at  DATETIME(3)  NOT NULL,
    read_at     DATETIME(3)  NULL,
    INDEX caregiver_notes_user_time_idx (user_id, created_at),
    CONSTRAINT caregiver_notes_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""

NOTES_WINDOW = timedelta(hours=24)
# A battery report older than this is from a phone that stopped reporting (session ended, app closed).
DEVICE_FRESH = timedelta(minutes=10)
# Low-battery alert on the dashboard, like the phone's own spoken warning.
LOW_BATTERY = 20


def init_caregiver_tables() -> None:
    """Creates the two tables on startup if they don't exist yet (never drops or changes data)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        for statement in (DEVICE_TABLE, NOTES_TABLE):
            cur.execute(statement)


# ---------- battery ----------

class DeviceBody(BaseModel):
    session_id: str | None = None
    battery: int = Field(ge=0, le=100)
    charging: bool = False


def _uuid_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError(400, "invalid_session_id", "session_id must be a UUID.") from None


@router.post("/device")
def report_device(body: DeviceBody, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The phone's battery, sent when a session starts and whenever the level or charging changes."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO device_status (user_id, session_id, battery, charging, updated_at) VALUES (%s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), battery = VALUES(battery), "
            "charging = VALUES(charging), updated_at = VALUES(updated_at)",
            (user_id, _uuid_or_none(body.session_id), body.battery, body.charging, _now()),
        )
    return {"ok": True}


def device_status(user_id: str) -> dict | None:
    """The phone's latest battery report, or None when there is none or it is too old to trust."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT session_id, battery, charging, updated_at FROM device_status WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row or _now() - row["updated_at"] > DEVICE_FRESH:
        return None
    return {"session_id": row["session_id"], "battery": int(row["battery"]), "charging": bool(row["charging"]),
            "updated_at": _iso(row["updated_at"])}


@router.get("/device")
def read_device(user_id: str = Depends(signed_in_user_id)) -> dict:
    return {"device": device_status(user_id)}
