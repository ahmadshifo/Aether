"""Overridable dependencies with one lazy existing Database engine per app."""

from fastapi import Depends, Request

from api.search_service import SearchService, SearchSettings
from database.connection import Database
from database.repository import FrameRepository
from processing.embedding_service import EmbeddingService


def get_settings(request: Request):
    return request.app.state.settings


def get_clock(request: Request):
    return request.app.state.clock


def get_database(request: Request):
    with request.app.state.database_lock:
        if request.app.state.database is None:
            request.app.state.database = Database()
        return request.app.state.database


def get_repository(database=Depends(get_database)):
    return FrameRepository.from_database(database)


def get_embedding_service():
    return EmbeddingService()


def get_search_settings():
    return SearchSettings.from_env()


def get_search_service(repository=Depends(get_repository), embedding=Depends(get_embedding_service),
                       clock=Depends(get_clock), settings=Depends(get_search_settings)):
    return SearchService(repository, embedding, clock=clock, settings=settings)
