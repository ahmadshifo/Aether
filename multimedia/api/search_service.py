"""Task 11: bounded time/semantic retrieval, without HTTP endpoints."""

import argparse
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
import heapq
import math
from numbers import Integral, Real
import os
import re
import sys

from dotenv import dotenv_values

from database.connection import ENV_FILE
from database.validation import as_utc, as_uuid, validate_embedding
from processing.embedding_service import DEFAULT_MODEL, EXPECTED_DIMENSIONS, cosine_similarity, validate_text

_DEFAULT_LIMIT = object()


class SearchError(RuntimeError):
    """Public search errors contain no provider, SQL, vector or credential data."""


class SearchConfigurationError(SearchError):
    pass


class SearchRepositoryError(SearchError):
    pass


class SearchEmbeddingError(SearchError):
    pass


@dataclass(frozen=True)
class SearchSettings:
    latest_seconds: int = 10
    recent_seconds: int = 120
    default_limit: int = 5
    max_limit: int = 20
    batch_size: int = 128
    min_similarity: float | None = None
    ocr_boost: float = 0.1

    def __post_init__(self):
        for name in ("latest_seconds", "recent_seconds", "default_limit", "max_limit", "batch_size"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, Integral) or value < 1:
                raise SearchConfigurationError(f"{name} must be a positive integer.")
        if not self.default_limit <= self.max_limit <= 20 or self.batch_size > 1000:
            raise SearchConfigurationError("Require default_limit <= max_limit <= 20 and batch_size <= 1000.")
        if self.latest_seconds > self.recent_seconds:
            raise SearchConfigurationError("latest_seconds must not exceed recent_seconds.")
        for name, lower, upper in (("min_similarity", -1, 1), ("ocr_boost", 0, 1)):
            value = getattr(self, name)
            if value is None and name == "min_similarity":
                continue
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or not lower <= value <= upper:
                raise SearchConfigurationError(f"{name} must be finite and between {lower} and {upper}.")

    @classmethod
    def from_env(cls):
        try:
            values = dotenv_values(ENV_FILE, interpolate=False)
            def get(name, default):
                return os.environ.get(name, values.get(name, default))
            options = {}
            for name, default in (("latest_seconds", 10), ("recent_seconds", 120),
                                  ("default_limit", 5), ("max_limit", 20), ("batch_size", 128)):
                raw = get("SEARCH_" + name.upper(), str(default))
                if not isinstance(raw, str) or not re.fullmatch(r"[0-9]+", raw.strip()):
                    raise ValueError()
                options[name] = int(raw)
            raw = get("SEARCH_MIN_SIMILARITY", "")
            options["min_similarity"] = None if raw is None or not str(raw).strip() else float(raw)
            options["ocr_boost"] = float(get("SEARCH_OCR_BOOST", "0.1"))
            return cls(**options)
        except SearchError:
            raise
        except Exception:
            raise SearchConfigurationError("Invalid SEARCH_* settings in api/.env or the environment.") from None


def _ocr_match(query: str, ocr_text: str) -> bool:
    # Whole Unicode word/number tokens, preserving 205 vs 206 and 2050.
    def tokens(value):
        return " ".join(re.findall(r"\w+", value.casefold(), flags=re.UNICODE))
    question = f" {tokens(query)} "
    return any(visible and f" {visible} " in question
               for visible in (tokens(line) for line in ocr_text.splitlines()))


@dataclass(order=True)
class _Match:
    key: tuple
    result: dict = field(compare=False, repr=False)


class SearchService:
    def __init__(self, repository, embedding_service, *, settings=None, clock=None):
        self.repository = repository
        self.embedding_service = embedding_service
        self.settings = SearchSettings.from_env() if settings is None else settings
        if not isinstance(self.settings, SearchSettings):
            raise TypeError("settings must be SearchSettings.")
        self.clock = (lambda: datetime.now(UTC)) if clock is None else clock

    def _query_vector(self, query):
        try:
            if getattr(self.embedding_service, "model", DEFAULT_MODEL) != DEFAULT_MODEL:
                raise ValueError()
            result = self.embedding_service.embed_query(query)
            if result.model != DEFAULT_MODEL or result.dimensions != EXPECTED_DIMENSIONS:
                raise ValueError()
            vector = validate_embedding(result.embedding, result.model)
            if vector is None:
                raise ValueError()
            return vector
        except Exception:
            raise SearchEmbeddingError("Query embedding failed; require one finite 1536-value text-embedding-3-small vector. Check embedding configuration or provider availability.") from None

    def search(self, session_id, query, mode="recent", limit=_DEFAULT_LIMIT):
        session_id = as_uuid(session_id, "session_id")
        query = validate_text(query)
        if mode not in ("latest", "recent", "history"):
            raise ValueError("mode must be latest, recent, or history.")
        limit = self.settings.default_limit if limit is _DEFAULT_LIMIT else limit
        if isinstance(limit, bool) or not isinstance(limit, Integral) or not 1 <= limit <= self.settings.max_limit:
            raise ValueError(f"limit must be an integer from 1 to {self.settings.max_limit}.")
        now = as_utc(self.clock(), "search clock")
        seconds = self.settings.latest_seconds if mode == "latest" else self.settings.recent_seconds
        start = None if mode == "history" else now - timedelta(seconds=seconds)
        try:
            iterator = iter(self.repository.iter_search_candidates(
                session_id, start_time=start, end_time=now, now=now, batch_size=self.settings.batch_size))
        except Exception:
            raise SearchRepositoryError("Could not retrieve search candidates; database details were suppressed.") from None
        best, query_vector = [], None
        try:
            while True:
                try:
                    row = next(iterator)
                except StopIteration:
                    break
                except Exception:
                    raise SearchRepositoryError("Search candidate retrieval failed; database details were suppressed.") from None
                # Defend the boundary even with a fake or faulty repository.
                try:
                    frame_id = as_uuid(row.frame_id, "frame_id")
                    if as_uuid(row.session_id, "session_id") != session_id:
                        continue
                    capture, expires = as_utc(row.captured_at), as_utc(row.expires_at, "expires_at")
                    if capture > now or (start is not None and capture < start) or expires <= now:
                        continue
                    if not isinstance(row.ocr_text, str) or not isinstance(row.caption, str):
                        continue
                    if not isinstance(row.objects, list) or any(not isinstance(label, str) for label in row.objects):
                        continue
                except (ValueError, TypeError, AttributeError):
                    continue
                score = 0.0
                if mode != "latest":
                    exact = _ocr_match(query, row.ocr_text)
                    if row.embedding is None:
                        if not exact or self.settings.min_similarity is not None:
                            continue
                    else:
                        try:
                            vector = validate_embedding(row.embedding, row.embedding_model)
                        except (ValueError, TypeError, OverflowError):
                            continue
                        if query_vector is None:
                            query_vector = self._query_vector(query)
                        similarity = cosine_similarity(query_vector, vector)
                        if self.settings.min_similarity is not None and similarity < self.settings.min_similarity:
                            continue
                        score = ((similarity + 1.0) / 2.0 + (self.settings.ocr_boost if exact else 0.0)) / (1.0 + self.settings.ocr_boost)
                        score = min(1.0, max(0.0, score))
                timestamp = capture.isoformat().replace("+00:00", "Z")
                result = {"frame_id": str(frame_id), "session_id": str(session_id),
                          "timestamp": timestamp, "captured_at": timestamp,
                          "image_url": f"/api/v1/frames/{frame_id}/image",
                          "caption": row.caption, "ocr_text": row.ocr_text,
                          "objects": list(row.objects), "relevance_score": score}
                key = (capture, frame_id.int) if mode == "latest" else (score, capture, frame_id.int)
                item = _Match(key, result)
                if len(best) < limit:
                    heapq.heappush(best, item)
                elif key > best[0].key:
                    heapq.heapreplace(best, item)
        finally:
            close = getattr(iterator, "close", None)
            if callable(close):
                active_error = sys.exc_info()[0] is not None
                try:
                    close()
                except Exception:
                    if not active_error:
                        raise SearchRepositoryError("Could not close search candidate iteration safely.") from None
        return {"frames": [item.result for item in sorted(best, reverse=True)]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", choices=("latest", "recent", "history"), default="recent")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--min-similarity", type=float)
    parser.add_argument("--offline-demo", action="store_true", help="Synthetic in-memory data/vectors; no MySQL or AI calls")
    parser.add_argument("--json", action="store_true", help="Print the API-compatible response object")
    args = parser.parse_args(argv)
    try:
        from contextlib import nullcontext
        from dataclasses import replace
        settings = SearchSettings.from_env()
        if args.min_similarity is not None:
            settings = replace(settings, min_similarity=args.min_similarity)
        # Validate before configuring any real database or provider client.
        as_uuid(args.session_id, "session_id")
        validate_text(args.query)
        if args.limit is not None and not 1 <= args.limit <= settings.max_limit:
            raise ValueError(f"limit must be between 1 and {settings.max_limit}.")
        if args.offline_demo:
            from .search_demo import offline_components
            repository, embedding, now = offline_components()
            context = nullcontext()
        else:
            from database.connection import Database
            from database.repository import FrameRepository
            from processing.embedding_service import EmbeddingService
            context = Database()
        with context as database:
            if not args.offline_demo:
                repository = FrameRepository.from_database(database)
                embedding, now = EmbeddingService(), None
            service = SearchService(repository, embedding, settings=settings,
                                    clock=None if now is None else lambda: now)
            response = service.search(args.session_id, args.query, args.mode,
                                      settings.default_limit if args.limit is None else args.limit)
        if args.json:
            import json
            print(json.dumps(response, ensure_ascii=False, allow_nan=False))
        else:
            print("Aether - Multimedia Search" + (" (OFFLINE synthetic demo)" if args.offline_demo else ""))
            print(f"Query: {args.query}\nMode: {args.mode}\nSession: {args.session_id}")
            print(f"Matching frames: {len(response['frames'])}")
            for index, frame in enumerate(response["frames"], 1):
                print(f"\n{index}. Frame: {frame['frame_id']}\n   Time: {frame['timestamp']}\n"
                      f"   OCR: {frame['ocr_text']}\n   Objects: {', '.join(frame['objects'])}\n"
                      f"   Relevance score: {frame['relevance_score']:.6f}")
            print("Search completed successfully.")
        return 0
    except (ValueError, TypeError, SearchError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("Error: Search could not complete; verify database and embedding configuration. Details were suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
