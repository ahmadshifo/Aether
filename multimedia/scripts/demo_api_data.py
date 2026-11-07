"""Create/delete one explicitly synthetic frame in an existing owned session."""

import argparse
from datetime import UTC, datetime, timedelta
import json
import sys

import numpy as np

from database.connection import Database
from database.errors import DatabaseError
from database.models import StreamSession
from database.repository import FrameRepository
from database.validation import as_uuid

DEMO_CAPTION = "Task 12 synthetic classroom door for HTTP verification."


def seed(session_id):
    session_id = as_uuid(session_id, "session_id")
    with Database() as database:
        with database.sessions() as sql_session:
            session = sql_session.get(StreamSession, session_id)
            if session is None or session.user_id is None:
                raise ValueError("Create an owned session through the existing streams/start API before seeding.")
        repository = FrameRepository.from_database(database)
        # Explicit test image only; no camera, OCR, Vision or embedding request.
        image = np.full((48, 64, 3), 160, dtype=np.uint8)
        identifier = repository.save_frame(session_id, datetime.now(UTC) - timedelta(seconds=2), image,
                                           ocr_text="ROOM 205", objects=["door", "sign"], caption=DEMO_CAPTION)
        return {"session_id": str(session_id), "frame_id": str(identifier),
                "image_url": f"/api/v1/frames/{identifier}/image"}


def cleanup(session_id, frame_id):
    session_id, frame_id = as_uuid(session_id, "session_id"), as_uuid(frame_id, "frame_id")
    with Database() as database:
        repository = FrameRepository.from_database(database)
        frame = repository.get_frame(frame_id)
        if frame is None:
            return {"deleted": False}
        if frame.session_id != session_id or frame.caption != DEMO_CAPTION or frame.ocr_text != "ROOM 205":
            raise ValueError("Refusing to delete a record that is not this session's synthetic API demo frame.")
        return {"deleted": repository.delete_frame(frame_id)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--delete", action="store_true")
    parser.add_argument("--frame-id")
    args = parser.parse_args(argv)
    try:
        if args.delete != bool(args.frame_id):
            raise ValueError("Use --delete and --frame-id together to remove only the specified demo frame.")
        result = cleanup(args.session_id, args.frame_id) if args.delete else seed(args.session_id)
        print(json.dumps(result, allow_nan=False))
        return 0
    except (DatabaseError, ValueError, TypeError):
        print("Error: Demo operation failed; verify database, session and synthetic frame identifiers. Details suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
