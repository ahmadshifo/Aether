"""Central error translation; no raw SQL, provider bodies or request values."""

import logging

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from api.search_service import SearchConfigurationError, SearchEmbeddingError, SearchRepositoryError
from database.errors import DatabaseError
from processing.embedding_service import EmbeddingServiceError

LOGGER = logging.getLogger("aether.multimedia")


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def error_response(status, code, message, fields=()):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "fields": list(fields)}},
                        headers={"Cache-Control": "private, no-store"})


def install_handlers(app):
    @app.exception_handler(ApiError)
    async def known_error(request, exc):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        allowed = {"session_id", "query", "mode", "limit", "cursor", "frame_id"}
        fields = sorted({part for item in exc.errors() for part in item.get("loc", ()) if part in allowed})
        return error_response(422, "invalid_request", "Invalid request body or parameters.", fields)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        messages = {404: "Resource not found.", 405: "Method not allowed.", 401: "Authentication required.", 403: "Access denied."}
        return error_response(exc.status_code, "http_error", messages.get(exc.status_code, "Request could not be processed."))

    async def database_error(request, exc):
        LOGGER.warning("Database operation unavailable (%s).", type(exc).__name__)
        return error_response(503, "database_unavailable", "Database service is unavailable.")

    for kind in (DatabaseError, SQLAlchemyError, SearchRepositoryError):
        app.add_exception_handler(kind, database_error)

    async def embedding_error(request, exc):
        LOGGER.warning("Embedding operation unavailable (%s).", type(exc).__name__)
        return error_response(502, "embedding_unavailable", "Query embedding service is unavailable.")

    for kind in (SearchEmbeddingError, EmbeddingServiceError):
        app.add_exception_handler(kind, embedding_error)

    @app.exception_handler(SearchConfigurationError)
    async def search_settings_error(request, exc):
        return error_response(503, "search_unavailable", "Search configuration is unavailable.")
