"""Thin synchronous HTTP handlers over the Task 10 repository and Task 11 search."""

import base64
import binascii
import json
import re
from typing import Annotated
from uuid import UUID

from datetime import timedelta
from threading import Thread

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BeforeValidator, Field

from api.dependencies import get_clock, get_repository, get_search_service, get_search_settings
from api.errors import ApiError
from api.schemas import (ErrorResponse, FrameMetadata, HealthResponse, KeepRequest, KeepResponse, SearchRequest,
                         SearchResponse, TimelineResponse)
from api.security import get_principal, require_session_access
from database.errors import ImageStorageError
from database.repository import FrameCursor
from database.validation import as_utc, as_uuid

router = APIRouter()
ERRORS = {status: {"model": ErrorResponse} for status in (401, 404, 422, 500, 502, 503)}


def _query_integer(value):
    if isinstance(value, bool) or not (isinstance(value, int) or isinstance(value, str) and re.fullmatch(r"[0-9]+", value)):
        raise ValueError("limit must be an integer.")
    return int(value)


TimelineLimit = Annotated[int, Field(ge=1, le=100), BeforeValidator(_query_integer)]


def encode_cursor(session_id, capture, frame_id):
    payload = {"v": 1, "session_id": str(session_id), "captured_at": as_utc(capture).isoformat(), "frame_id": str(frame_id)}
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(value, session_id):
    if value is None:
        return None
    try:
        if not 1 <= len(value) <= 768 or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError()
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if set(payload) != {"v", "session_id", "captured_at", "frame_id"} or type(payload["v"]) is not int or payload["v"] != 1:
            raise ValueError()
        if as_uuid(payload["session_id"], "session_id") != session_id:
            raise ValueError()
        return FrameCursor(as_utc(payload["captured_at"]), as_uuid(payload["frame_id"], "frame_id"))
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeError):
        raise ApiError(422, "invalid_cursor", "Cursor must be a valid timeline cursor for this session.") from None


def public_metadata(row):
    capture = as_utc(row.captured_at)
    return FrameMetadata(frame_id=row.frame_id, session_id=row.session_id, timestamp=capture, captured_at=capture,
                         image_url=f"/api/v1/frames/{row.frame_id}/image", caption=row.caption,
                         ocr_text=row.ocr_text, objects=row.objects)


def merge_live_frames(memory, stored, session_id, mode, limit, now, settings):
    """latest/recent also see the blurred live frames held in RAM (not analyzed yet, so their text fields
    are empty). latest: newest first. recent: ranked stored matches first, then live frames spread over
    the window. Live relevance is freshness within the window, never a claim about content."""
    seconds = settings.latest_seconds if mode == "latest" else settings.recent_seconds
    now = as_utc(now)
    live = memory.frames(session_id, since=now - timedelta(seconds=seconds)) if memory is not None else []
    seen = {str(frame["frame_id"]) for frame in stored}
    extra = []
    for item in live:
        if str(item.frame_id) in seen or item.captured_at > now:
            continue
        capture = as_utc(item.captured_at)
        stamp = capture.isoformat().replace("+00:00", "Z")
        extra.append({"frame_id": str(item.frame_id), "session_id": str(item.session_id), "timestamp": stamp,
                      "captured_at": stamp, "image_url": f"/api/v1/frames/{item.frame_id}/image",
                      "caption": "", "ocr_text": "", "objects": [],
                      "relevance_score": round(min(1.0, max(0.0, 1 - (now - capture).total_seconds() / seconds)), 4)})
    if mode == "latest":
        merged = sorted(list(stored) + extra, key=lambda frame: frame["captured_at"], reverse=True)
        return merged[:limit]
    room = max(0, limit - len(stored))
    if len(extra) > room > 1:
        step = (len(extra) - 1) / (room - 1)
        extra = [extra[round(i * step)] for i in range(room)]
    return list(stored)[:limit] + extra[:room]


@router.post("/api/v1/frames/keep", response_model=KeepResponse, status_code=202, responses=ERRORS, tags=["frames"],
             summary="Save the frames an answer used (from the 2-minute live memory)")
def keep(body: KeepRequest, request: Request, user_id=Depends(get_principal), repository=Depends(get_repository)):
    require_session_access(repository, body.session_id, user_id)
    keeper = request.app.state.keeper
    if keeper is None:
        raise ApiError(503, "live_unavailable", "Live frame saving is not running.")
    accepted, missing, to_save = [], [], []
    for frame_id in dict.fromkeys(body.frame_ids):
        item = request.app.state.memory.get(frame_id)
        if item is not None and item.session_id == body.session_id:
            accepted.append(frame_id)
            to_save.append(item)
            continue
        row = repository.get_frame(frame_id)
        (accepted if row is not None and row.session_id == body.session_id else missing).append(frame_id)
    if to_save:
        from processing.live_service import keep_frames
        # Analysis can take seconds per frame; the caller (the answer) must not wait for it.
        Thread(target=keep_frames, args=(keeper, to_save), name="aether-keep", daemon=True).start()
    return KeepResponse(accepted=accepted, missing=missing)


@router.get("/health", response_model=HealthResponse, tags=["health"],
            summary="HTTP process liveness; does not claim database or AI readiness")
def health():
    return HealthResponse()


@router.post("/api/v1/search", response_model=SearchResponse, responses=ERRORS, tags=["frames"],
             summary="Search an owned session by latest, recent or retained history",
             description="Reuses Task 11 ranking. Latest prioritizes the last 10 seconds, recent searches two minutes, history searches all retained frames. Empty results are successful. Existing login cookies are required.")
def search(body: SearchRequest, request: Request, user_id=Depends(get_principal), repository=Depends(get_repository),
           search_service=Depends(get_search_service), settings=Depends(get_search_settings)):
    if body.limit > settings.max_limit:
        raise ApiError(422, "invalid_request", "limit exceeds the configured search maximum.")
    require_session_access(repository, body.session_id, user_id)
    found = search_service.search(session_id=body.session_id, query=body.query, mode=body.mode, limit=body.limit)
    if len(found["frames"]) > body.limit:  # checked before live frames are merged in, so it is never hidden
        raise RuntimeError("Search returned inconsistent metadata.")
    if body.mode != "history":
        found = {"frames": merge_live_frames(request.app.state.memory, found["frames"], body.session_id,
                                             body.mode, body.limit, request.app.state.clock(), settings)}
    result = SearchResponse.model_validate(found)
    # Mapping mistakes are server errors, not quietly filtered success responses.
    if len(result.frames) > body.limit or any(frame.session_id != body.session_id for frame in result.frames):
        raise RuntimeError("Search returned inconsistent metadata.")
    return result


@router.get("/api/v1/frames", response_model=TimelineResponse, responses=ERRORS, tags=["frames"],
            summary="Unexpired frame timeline for an owned session, newest first")
def timeline(session_id: UUID, limit: Annotated[TimelineLimit, Query()] = 20,
             cursor: Annotated[str | None, Query(max_length=768)] = None,
             user_id=Depends(get_principal), repository=Depends(get_repository), clock=Depends(get_clock)):
    require_session_access(repository, session_id, user_id)
    before = decode_cursor(cursor, session_id)
    now = as_utc(clock())
    rows = repository.list_timeline_frames(session_id, limit + 1, before=before, now=now)
    rows = [row for row in rows if row.session_id == session_id and as_utc(row.expires_at) > now and as_utc(row.captured_at) <= now]
    rows.sort(key=lambda row: (as_utc(row.captured_at), as_uuid(row.frame_id, "frame_id").int), reverse=True)
    page = rows[:limit]
    next_cursor = encode_cursor(session_id, page[-1].captured_at, page[-1].frame_id) if len(rows) > limit else None
    return TimelineResponse(frames=[public_metadata(row) for row in page], next_cursor=next_cursor)


@router.get("/api/v1/frames/{frame_id}/image", responses={**ERRORS, 200: {"content": {"image/jpeg": {}}, "description": "Authorized private JPEG bytes"}},
            response_class=Response, tags=["frames"], summary="Read a non-expired JPEG after checking session ownership")
def image(frame_id: UUID, request: Request, user_id=Depends(get_principal), repository=Depends(get_repository),
          clock=Depends(get_clock)):
    live = request.app.state.memory.get(frame_id)
    if live is not None:
        require_session_access(repository, live.session_id, user_id)
        return Response(content=live.jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, no-store",
                                                                            "X-Content-Type-Options": "nosniff"})
    row = repository.get_frame(frame_id)
    if row is None or as_utc(row.expires_at) <= as_utc(clock()):
        raise ApiError(404, "not_found", "Session or frame not found.")
    require_session_access(repository, row.session_id, user_id)
    try:
        jpeg = repository.load_frame_image(frame_id)
    except ImageStorageError:
        raise ApiError(404, "not_found", "Stored image is unavailable.") from None
    if jpeg is None or as_utc(row.expires_at) <= as_utc(clock()):
        raise ApiError(404, "not_found", "Stored image is unavailable.")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, no-store",
                                                                   "X-Content-Type-Options": "nosniff"})
