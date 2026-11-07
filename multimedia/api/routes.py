"""Thin synchronous HTTP handlers over the Task 10 repository and Task 11 search."""

import base64
import binascii
import json
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BeforeValidator, Field

from api.dependencies import get_clock, get_repository, get_search_service, get_search_settings
from api.errors import ApiError
from api.schemas import ErrorResponse, FrameMetadata, HealthResponse, SearchRequest, SearchResponse, TimelineResponse
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


@router.get("/health", response_model=HealthResponse, tags=["health"],
            summary="HTTP process liveness; does not claim database or AI readiness")
def health():
    return HealthResponse()


@router.post("/api/v1/search", response_model=SearchResponse, responses=ERRORS, tags=["frames"],
             summary="Search an owned session by latest, recent or retained history",
             description="Reuses Task 11 ranking. Latest prioritizes the last 10 seconds, recent searches two minutes, history searches all retained frames. Empty results are successful. Existing login cookies are required.")
def search(body: SearchRequest, user_id=Depends(get_principal), repository=Depends(get_repository),
           search_service=Depends(get_search_service), settings=Depends(get_search_settings)):
    if body.limit > settings.max_limit:
        raise ApiError(422, "invalid_request", "limit exceeds the configured search maximum.")
    require_session_access(repository, body.session_id, user_id)
    result = SearchResponse.model_validate(search_service.search(
        session_id=body.session_id, query=body.query, mode=body.mode, limit=body.limit))
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
def image(frame_id: UUID, user_id=Depends(get_principal), repository=Depends(get_repository), clock=Depends(get_clock)):
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
