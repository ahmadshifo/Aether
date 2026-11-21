"""Member 1: FastAPI entry point for the voice backend; mounts the voice routes and health endpoint."""

from fastapi import FastAPI

from app.routes import router

app = FastAPI(title="Mobile Voice Service")
app.include_router(router)
