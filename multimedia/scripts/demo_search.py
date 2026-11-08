"""Task 11 scenarios A-F with synthetic query vectors; --mysql opts into MySQL."""

import argparse
from contextlib import ExitStack
from dataclasses import replace
from datetime import UTC, datetime
import sys
from uuid import uuid4

from api.search_demo import (DEMO_NOW, DEMO_SESSION, OTHER_SESSION, InMemoryDemoRepository,
                             SyntheticQuery, demo_candidates)
from api.search_service import SearchService, SearchSettings


def run(mysql=False):
    now = datetime.now(UTC) if mysql else DEMO_NOW
    session_a, session_b = (uuid4(), uuid4()) if mysql else (DEMO_SESSION, OTHER_SESSION)
    rows = demo_candidates(now, session_a, session_b)
    identifiers = []
    print("Aether - Task 11 " + ("REAL MySQL, synthetic vectors" if mysql else "OFFLINE synthetic demo"))
    print(f"Session A: {session_a}\nSession B: {session_b}")
    with ExitStack() as stack:
        if mysql:
            import numpy as np
            from database.connection import Database
            from database.repository import FrameRepository
            database = stack.enter_context(Database())
            database.check()
            repository = FrameRepository.from_database(database)
        else:
            repository = InMemoryDemoRepository(rows)
        try:
            if mysql:
                saved = []
                image = np.full((24, 32, 3), 150, dtype=np.uint8)
                for row in rows:
                    identifier = uuid4()
                    identifiers.append(identifier)
                    repository.save_frame(row.session_id, row.captured_at, image, row.ocr_text, row.objects,
                                          row.caption, row.embedding, row.embedding_model, frame_id=identifier)
                    saved.append(replace(row, frame_id=identifier))
                rows = saved
            service = SearchService(repository, SyntheticQuery(), settings=SearchSettings(batch_size=2), clock=lambda: now)
            query = "What was written on the classroom door?"
            recent = service.search(session_a, query, "recent")
            assert recent["frames"][0]["frame_id"] == str(rows[0].frame_id)
            print("A - Recent classroom door ranked first: " + recent["frames"][0]["ocr_text"])
            for frame in recent["frames"]:
                print(f"    {frame['frame_id']} | {frame['ocr_text']} | {frame['relevance_score']:.6f}")
            latest = service.search(session_a, query, "latest")
            assert [frame["frame_id"] for frame in latest["frames"]] == [str(rows[3].frame_id)]
            print("B - Latest returned only the 3-second-old frame; older-than-10-second frames excluded")
            history = service.search(session_a, query, "history", 20)
            assert str(rows[4].frame_id) in [frame["frame_id"] for frame in history["frames"]]
            print("C - History includes the retained frame captured one hour ago")
            strict = SearchService(repository, SyntheticQuery(), settings=SearchSettings(min_similarity=0.6), clock=lambda: now)
            assert strict.search(session_a, "purple umbrella", "history") == {"frames": []}
            print("D - Unrelated synthetic vector below raw cosine threshold 0.6 returned no frames")
            other = service.search(session_b, query, "history")
            assert [frame["frame_id"] for frame in other["frames"]] == [str(rows[5].frame_id)]
            assert all(frame["session_id"] == str(session_a) for frame in history["frames"])
            print("E - Both test sessions remained isolated")
            for changes in ({"session_id": "invalid"}, {"mode": "wrong"}, {"limit": 0}):
                request = dict(session_id=session_a, query=query, mode="recent", limit=5)
                request.update(changes)
                try:
                    service.search(**request)
                except ValueError:
                    pass
                else:
                    raise AssertionError("An invalid search request was accepted.")
            print("F - Invalid UUID, mode and limit rejected")
            print("Scenarios passed. No OpenAI, OCR or Vision requests were made.")
        finally:
            if mysql:
                for identifier in identifiers:
                    repository.delete_frame(identifier)
                print("Deleted only this demo's generated UUIDs and JPEGs.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mysql", action="store_true", help="Use configured MySQL with temporary synthetic rows and cleanup")
    args = parser.parse_args(argv)
    try:
        run(args.mysql)
        return 0
    except Exception:
        print("Error: Search demonstration failed; verify schema/configuration. No external AI request was made.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
