"""Member 3: implement latest/recent/history retrieval using timestamps, text and vector similarity.

Modes (time windows are measured back from now, in UTC):
- latest:  live frames from the last 10 seconds (RAM memory), newest first.
- recent:  live frames from the last 2 minutes (RAM memory), spread across the window, newest first.
- history: frames that were saved because an answer used them (MySQL/RustFS), most relevant first.

Live frames are not analyzed yet (no AI calls until a frame is kept), so latest/recent rank by
freshness and the AI backend reads the images itself. History frames carry OCR, caption, objects
and an embedding, so they are ranked by meaning (cosine similarity of the query embedding)
blended with plain word matches; this still works when embeddings are unavailable.
relevance_score is a ranking score in [0, 1], not a probability. An empty `frames` list means no
match; nothing is invented.
"""

import logging
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

log = logging.getLogger("multimedia.search")

WINDOWS = {"latest": timedelta(seconds=10), "recent": timedelta(minutes=2), "history": None}
MAX_CANDIDATES = 1000          # newest saved frames considered per history search
SEMANTIC_WEIGHT = 0.8
MIN_RELEVANCE = 0.2            # history drops weaker matches
WORD = re.compile(r"[\w']+", re.UNICODE)


@dataclass(frozen=True)
class RankedFrame:
    record: object
    relevance_score: float


def _words(text: str) -> set[str]:
    return {word.casefold() for word in WORD.findall(text or "") if len(word) > 1 or word.isdigit()}


def keyword_score(query: str, record) -> float:
    wanted = _words(query)
    if not wanted:
        return 0.0
    found = _words(" ".join([record.ocr_text or "", record.caption or "", " ".join(record.objects or [])]))
    return len(wanted & found) / len(wanted)


def cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def spread(items: list, limit: int) -> list:
    """Up to `limit` items evenly spaced across a newest-first list, always including the newest."""
    if len(items) <= limit:
        return items
    if limit == 1:
        return items[:1]
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


class SearchService:
    def __init__(self, repository, memory=None, embedder=None, clock=lambda: datetime.now(UTC)):
        self.repository = repository
        self.memory = memory
        self.embedder = embedder
        self.clock = clock

    def _query_vector(self, query: str):
        if self.embedder is None or not query.strip():
            return None
        try:
            return self.embedder.embed_query(query).embedding
        except Exception as error:
            log.warning("Query embedding unavailable (%s); using word matching only.", type(error).__name__)
            return None

    def score(self, query: str, record, vector) -> float:
        words = keyword_score(query, record)
        if vector is not None and getattr(record, "embedding", None) is not None:
            value = SEMANTIC_WEIGHT * max(0.0, cosine(vector, record.embedding)) + (1 - SEMANTIC_WEIGHT) * words
        else:
            value = words
        return round(min(1.0, max(0.0, value)), 4)

    def _live(self, session_id, mode: str, limit: int) -> list[RankedFrame]:
        if self.memory is None:
            return []
        now, window = self.clock(), WINDOWS[mode]
        items = self.memory.frames(session_id, since=now - window)
        chosen = items[:limit] if mode == "latest" else spread(items, limit)
        seconds = window.total_seconds()
        return [RankedFrame(item, round(min(1.0, max(0.0, 1 - (now - item.captured_at).total_seconds() / seconds)), 4))
                for item in chosen]

    def _history(self, session_id, query: str, limit: int) -> list[RankedFrame]:
        if self.repository is None:
            raise LookupError("saved frames are unavailable")
        now = self.clock()
        records = [r for r in self.repository.list_frames(session_id, limit=MAX_CANDIDATES) if r.expires_at > now]
        if not records:
            return []
        if not query.strip():
            return [RankedFrame(r, 1.0) for r in records[:limit]]
        vector = self._query_vector(query)
        ranked = [RankedFrame(r, self.score(query, r, vector)) for r in records]
        ranked = [item for item in ranked if item.relevance_score >= MIN_RELEVANCE]
        ranked.sort(key=lambda item: (item.relevance_score, item.record.captured_at), reverse=True)
        return ranked[:limit]

    def search(self, session_id, query: str, mode: str, limit: int) -> list[RankedFrame]:
        if mode not in WINDOWS:
            raise ValueError("mode must be latest, recent or history.")
        if mode == "history":
            return self._history(session_id, query, limit)
        return self._live(session_id, mode, limit)
