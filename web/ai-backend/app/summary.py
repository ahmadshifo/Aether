"""Member 2: the daily summary card on the dashboard's Overview page.

GET /api/v1/summary?tz_offset=-120 returns today's numbers for the signed-in account, counted in the
caregiver's own time zone (tz_offset is the browser's Date.getTimezoneOffset(), in minutes):
questions asked, how many answers were unsure, what the questions were mostly about, questions per hour,
how long the camera was on, and SOS alerts. Only counts and short labels: no images and no question text.
"""

from contextlib import closing
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from app.auth import _connect, _iso, _now, signed_in_user_id

router = APIRouter(prefix="/api/v1", tags=["summary"])

# What a question is about, checked in this order; the first matching group wins (English, Arabic, French).
TOPICS = (
    ("reading", ("read", "say", "written", "sign", "text", "label", "اقرأ", "مكتوب", "لافتة", "lis", "écrit", "panneau")),
    ("finding", ("where", "find", "lost", "my keys", "my bag", "أين", "وين", "لاقي", "où", "trouve")),
    ("safety", ("way", "clear", "obstacle", "step", "stairs", "car", "طريق", "درج", "chemin", "marche")),
    ("describing", ("front", "see", "what is", "what's", "look", "أمامي", "شو في", "شو هيدا", "devant", "vois", "qu'est")),
)


def topic_of(question: str) -> str:
    """The group a question belongs to: reading, finding, safety, describing or other."""
    text = question.lower()
    for topic, words in TOPICS:
        if any(word in text for word in words):
            return topic
    return "other"


def day_window(now_utc: datetime, tz_offset_minutes: int) -> tuple[datetime, datetime]:
    """Start and end of the caregiver's today, as naive UTC (like the database).

    tz_offset follows JavaScript: UTC minus local time, so Lebanon in winter (UTC+2) sends -120."""
    local_now = now_utc - timedelta(minutes=tz_offset_minutes)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_midnight + timedelta(minutes=tz_offset_minutes)
    return start, start + timedelta(days=1)


def camera_minutes(sessions: list[dict], start: datetime, end: datetime, now: datetime) -> int:
    """Minutes the camera was streaming inside [start, end); a session still live counts up to now."""
    total = timedelta()
    for session in sessions:
        began = max(session["started_at"], start)
        stopped = min(session["ended_at"] or now, end, now)
        if stopped > began:
            total += stopped - began
    return round(total.total_seconds() / 60)


def build_summary(questions: list[dict], sessions: list[dict], sos: list[dict],
                  start: datetime, end: datetime, now: datetime, tz_offset_minutes: int) -> dict:
    """Everything on the summary card, from plain rows (kept separate from the database so it can be tested)."""
    per_hour = [0] * 24
    topics: dict[str, int] = {}
    for row in questions:
        local_hour = (row["asked_at"] - timedelta(minutes=tz_offset_minutes)).hour
        per_hour[local_hour] += 1
        topic = topic_of(row["question"])
        topics[topic] = topics.get(topic, 0) + 1
    ranked = sorted(topics.items(), key=lambda item: (-item[1], item[0]))
    return {
        "day_start": _iso(start), "day_end": _iso(end),
        "questions": len(questions),
        "unsure_answers": sum(1 for row in questions if row["uncertain"]),
        "languages": {lang: sum(1 for row in questions if row["language"] == lang)
                      for lang in sorted({row["language"] for row in questions})},
        "topics": dict(ranked),
        "main_topic": ranked[0][0] if ranked else None,
        "questions_per_hour": per_hour,
        "busiest_hour": per_hour.index(max(per_hour)) if questions else None,
        "sessions": len(sessions),
        "camera_minutes": camera_minutes(sessions, start, end, now),
        "sos_alerts": len(sos),
        "sos_unanswered": sum(1 for row in sos if not row["acknowledged_at"]),
    }


@router.get("/summary")
def summary(tz_offset: int = Query(0, ge=-840, le=840), user_id: str = Depends(signed_in_user_id)) -> dict:
    """Today's summary for the signed-in account (see the module description)."""
    now = _now()
    start, end = day_window(now, tz_offset)
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT question, language, uncertain, asked_at FROM questions "
                    "WHERE user_id = %s AND asked_at >= %s AND asked_at < %s", (user_id, start, end))
        questions = cur.fetchall()
        cur.execute("SELECT started_at, ended_at FROM sessions WHERE user_id = %s AND started_at < %s "
                    "AND (ended_at IS NULL OR ended_at >= %s)", (user_id, end, start))
        sessions = cur.fetchall()
        cur.execute("SELECT acknowledged_at FROM sos_alerts WHERE user_id = %s AND created_at >= %s AND created_at < %s",
                    (user_id, start, end))
        sos = cur.fetchall()
    return build_summary(questions, sessions, sos, start, end, now, tz_offset)
