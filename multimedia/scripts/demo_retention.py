"""Seed/verify/remove only unique synthetic retention demonstration records."""

import argparse
from datetime import UTC, datetime, timedelta
import json
import sys
from uuid import uuid4

import numpy as np
from sqlalchemy import update

from database.connection import Database
from database.models import Frame
from database.repository import FrameRepository
from database.validation import as_uuid

MARKER = "MOCK Task 13 retention fixture; not real camera analysis."


def seed(database, repository):
    sid = uuid4()
    ids = []
    try:
        now = datetime.now(UTC)
        for _ in range(2):
            ids.append(repository.save_frame(sid, now - timedelta(seconds=1),
                np.full((24, 32, 3), 128, dtype=np.uint8), caption=MARKER))
        with database.sessions.begin() as session:
            session.execute(update(Frame).where(Frame.frame_id == ids[0]).values(
                created_at=now - timedelta(hours=25), expires_at=now - timedelta(hours=1)))
        return {"session_id": str(sid), "expired_frame_id": str(ids[0]), "retained_frame_id": str(ids[1])}
    except Exception:
        for identifier in ids:
            repository.delete_frame(identifier)
        raise


def inspect_fixture(repository, sid, expired_id, retained_id):
    sid = as_uuid(sid, "session_id")
    ids = [as_uuid(expired_id, "expired_frame_id"), as_uuid(retained_id, "retained_frame_id")]
    if ids[0] == ids[1]:
        raise ValueError("Fixture frame IDs must be distinct.")
    rows = [repository.get_frame(identifier) for identifier in ids]
    for row in rows:
        if row is not None and (row.session_id != sid or row.caption != MARKER or row.ocr_text or row.objects or row.embedding is not None):
            raise ValueError("Refusing to operate on a non-fixture frame.")
    return sid, ids, rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--seed", action="store_true")
    action.add_argument("--verify", action="store_true", help="After retention execution, verify expired gone/active retained")
    action.add_argument("--remove-test-data", action="store_true")
    parser.add_argument("--session-id")
    parser.add_argument("--expired-frame-id")
    parser.add_argument("--retained-frame-id")
    args = parser.parse_args(argv)
    if not args.seed and not all((args.session_id, args.expired_frame_id, args.retained_frame_id)):
        parser.error("Fixture session and both frame IDs are required.")
    try:
        with Database() as database:
            database.check()
            repository = FrameRepository.from_database(database)
            if args.seed:
                result = seed(database, repository)
            else:
                sid, ids, rows = inspect_fixture(repository, args.session_id, args.expired_frame_id, args.retained_frame_id)
                if args.verify:
                    # UUID-derived paths, never a caller-supplied filesystem path.
                    expired_file = repository._safe_path(f"{sid}/{ids[0]}.jpg")
                    if rows[0] is not None or expired_file.exists() or rows[1] is None or rows[1].expires_at <= datetime.now(UTC) or not repository.load_frame_image(ids[1]):
                        raise ValueError("Fixture verification failed.")
                    result = {"expired_record_and_jpeg_removed": True, "unexpired_record_and_jpeg_retained": True}
                else:
                    result = {"test_records_removed": sum(repository.delete_frame(identifier) for identifier in ids)}
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(f"Retention fixture failed ({type(error).__name__}); private details suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
