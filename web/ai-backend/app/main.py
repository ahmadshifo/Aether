"""Member 2: FastAPI server for /api/v1/ask, /api/v1/questions and the dashboard status API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.auth import ApiError, init_db, router as auth_router
from app.history import init_history_table, router as history_router
from app.routes import router as ask_router
from app.status import router as status_router
from app.streams import router as streams_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    init_history_table()
    yield


app = FastAPI(title="Web AI Service", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(streams_router)
app.include_router(history_router)
app.include_router(status_router)
app.include_router(ask_router)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    field = ".".join(str(part) for part in exc.errors()[0]["loc"][1:]) or "body"
    return JSONResponse(
        {"error": {"code": "invalid_request", "message": f"Missing or invalid field: {field}."}}, status_code=422
    )
