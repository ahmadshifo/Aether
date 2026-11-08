"""Member 3: implement /api/v1/search, /api/v1/frames, /api/v1/frames/{id}/image and /health.

Live frames sit in RAM (FrameMemory) for 2 minutes; only frames that an answer used are saved,
via POST /api/v1/frames/keep. Errors use the shared shape {"error": {"code", "message"}}.
Expired frames are never returned. The API listens on 127.0.0.1 only (see scripts/start.mjs);
it is called by the AI backend and the dashboard proxy, not directly by phones.
"""

import base64
import binascii
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from .schemas import (FramePage, KeepRequest, KeepResponse, SearchFrame, SearchRequest, SearchResponse,
                      frame_from_record)

router = APIRouter()
log = logging.getLogger("multimedia.api")
NOT_FOUND = "Frame absent, inaccessible or expired."


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _search(request: Request):
    search = getattr(request.app.state, "search", None)
    if search is None:
        raise ApiError(503, "storage_unavailable", "Frame search is not available.")
    return search


def _repository(request: Request):
    repository = getattr(request.app.state, "repository", None)
    if repository is None:
        raise ApiError(503, "storage_unavailable", "Saved frames are not available; check MySQL and RustFS.")
    return repository


def encode_cursor(record) -> str:
    raw = f"{record.captured_at.isoformat()}|{record.frame_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str):
    from database.repository import FrameCursor
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        moment, frame_id = raw.split("|")
        return FrameCursor(datetime.fromisoformat(moment), UUID(frame_id))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise ApiError(400, "invalid_cursor", "cursor is not a value returned by this API.") from None


@router.post("/api/v1/search", response_model=SearchResponse)
def search_frames(body: SearchRequest, request: Request):
    search = _search(request)
    try:
        ranked = search.search(body.session_id, body.query, body.mode, body.limit)
    except LookupError:
        raise ApiError(503, "storage_unavailable", "Saved frames are not available; check MySQL and RustFS.") from None
    return SearchResponse(frames=[frame_from_record(item.record, SearchFrame, relevance_score=item.relevance_score)
                                  for item in ranked])


@router.post("/api/v1/frames/keep", response_model=KeepResponse, status_code=202)
def keep_frames(body: KeepRequest, request: Request):
    """Save the frames an answer used. Analysis (OCR, caption, embedding) and storage run in the
    background so the caller is not delayed; the frames stay viewable from RAM meanwhile."""
    from database.errors import DuplicateFrameError
    repository = _repository(request)
    memory = request.app.state.memory
    analyzer = request.app.state.analyzer
    accepted, missing, to_save = [], [], []
    for frame_id in dict.fromkeys(body.frame_ids):
        item = memory.get(frame_id) if memory is not None else None
        if item is not None and item.session_id == body.session_id:
            accepted.append(frame_id)
            to_save.append(item)
            continue
        saved = repository.get_frame(frame_id)
        (accepted if saved is not None and saved.session_id == body.session_id else missing).append(frame_id)

    def save_all():
        for item in to_save:
            try:
                analyzer.analyze_and_save(item.session_id, item, frame_id=item.frame_id)
            except DuplicateFrameError:
                pass  # Already kept by an earlier request.
            except Exception as error:
                log.error("Frame %s was not saved: %s", item.frame_id, type(error).__name__)

    if to_save:
        request.app.state.keeper(save_all)
    return KeepResponse(accepted=accepted, missing=missing)


@router.get("/api/v1/frames", response_model=FramePage)
def list_frames(request: Request, session_id: UUID, limit: int = Query(20, ge=1, le=100), cursor: str | None = None):
    """Timeline of saved (answer-evidence) frames, newest first."""
    from database.repository import FrameCursor
    repository, search = _repository(request), _search(request)
    before = decode_cursor(cursor) if cursor else None
    now = search.clock()
    # Collect limit + 1 unexpired rows; the extra one tells us whether another page exists.
    kept = []
    while len(kept) <= limit:
        batch = repository.list_frames(session_id, limit + 1, before=before)
        kept += [r for r in batch if r.expires_at > now]
        if len(batch) <= limit:
            break
        before = FrameCursor(batch[-1].captured_at, batch[-1].frame_id)
    has_more = len(kept) > limit
    kept = kept[:limit]
    return FramePage(frames=[frame_from_record(r) for r in kept],
                     next_cursor=encode_cursor(kept[-1]) if has_more else None)


@router.get("/api/v1/frames/{frame_id}/image")
def frame_image(frame_id: UUID, request: Request):
    from database.errors import ImageStorageError
    headers = {"Cache-Control": "private, max-age=300"}
    memory = getattr(request.app.state, "memory", None)
    item = memory.get(frame_id) if memory is not None else None
    if item is not None:
        return Response(content=item.jpeg, media_type="image/jpeg", headers=headers)
    repository, search = _repository(request), _search(request)
    record = repository.get_frame(frame_id)
    if record is None or record.expires_at <= search.clock():
        raise ApiError(404, "frame_not_found", NOT_FOUND)
    try:
        data = repository.load_frame_image(frame_id)
    except ImageStorageError:
        raise ApiError(404, "frame_not_found", NOT_FOUND) from None
    if data is None:
        raise ApiError(404, "frame_not_found", NOT_FOUND)
    return Response(content=data, media_type="image/jpeg", headers=headers)


def install_error_handlers(app):
    from fastapi.exceptions import RequestValidationError
    from database.errors import DatabaseError

    @app.exception_handler(ApiError)
    async def _api_error(request, error: ApiError):
        return error_response(error.status, error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def _invalid(request, error: RequestValidationError):
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        return error_response(400, "invalid_request", f"{where}: {first.get('msg', 'invalid value')}".strip(": "))

    @app.exception_handler(DatabaseError)
    async def _database(request, error: DatabaseError):
        return error_response(503, "storage_unavailable", "Frame storage failed; details were suppressed.")
