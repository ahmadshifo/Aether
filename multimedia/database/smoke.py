"""Real MySQL 8.4 smoke test using only synthetic data and unique test IDs."""

import argparse
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np

from .connection import Database, load_settings
from .errors import DatabaseError, RepositoryError
from .models import EMBEDDING_MODEL
from .repository import FrameRepository


def run_smoke_test():
    settings = load_settings()
    session_a, session_b = uuid4(), uuid4()
    ids = []
    image = np.full((48, 64, 3), 180, dtype=np.uint8)
    cv2.putText(image, "205", (4, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 1)
    vector = np.linspace(-0.5, 0.5, 1536).tolist()
    print(f"Synthetic test sessions: {session_a}, {session_b}")
    try:
        with Database(settings) as database:
            database.check()
            repository = FrameRepository.from_database(database)
            for index in range(4):
                frame_id = uuid4()
                ids.append(frame_id)
                print(f"Creating synthetic frame: {frame_id}")
                repository.save_frame(
                    session_a if index < 3 else session_b,
                    datetime(2020, 1, 1, tzinfo=UTC) + timedelta(seconds=index), image,
                    ocr_text="ROOM 205", objects=["door", "sign"], caption="A door with a room number sign.",
                    embedding=vector if index == 0 else None,
                    embedding_model=EMBEDDING_MODEL if index == 0 else None,
                    frame_id=frame_id, source_frame_index=index * 10, video_timestamp_ms=index * 1000,
                )
            record = repository.get_frame(ids[0])
            if record is None or record.ocr_text != "ROOM 205" or record.objects != ["door", "sign"]:
                raise RepositoryError("Smoke metadata round-trip failed.")
            embedding = repository.get_embedding(ids[0])
            if embedding is None or not np.allclose(embedding.embedding, vector, atol=1e-7):
                raise RepositoryError("Smoke vector round-trip failed.")
            jpeg = repository.load_frame_image(ids[0])
            if cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR) is None:
                raise RepositoryError("Smoke JPEG round-trip failed.")
            if repository.count_frames(session_a) != 3 or repository.count_frames(session_b) != 1:
                raise RepositoryError("Smoke session separation failed.")
            if [record.frame_id for record in repository.list_frames(session_a)] != list(reversed(ids[:3])):
                raise RepositoryError("Smoke timeline ordering failed.")
            print("Metadata, 1536-vector, JPEG, ordering and session isolation verified")
        # A separate Python process proves persistence beyond one application connection.
        try:
            child = subprocess.run([sys.executable, "-m", "database.smoke", "--verify", str(ids[0])],
                                   cwd=Path(__file__).resolve().parents[1],
                                   capture_output=True, text=True, timeout=30)
        except subprocess.SubprocessError:
            raise RepositoryError("Persistence verification process did not complete.") from None
        if child.returncode != 0:
            raise RepositoryError("Smoke persistence check failed in a fresh Python process.")
        print("Persistence verified in a separate Python process")
        with Database(settings) as database:
            repository = FrameRepository.from_database(database)
            repository.delete_frame(ids[0])
            if (repository.get_frame(ids[0]) is not None or repository.count_frames(session_a) != 2
                    or repository.image_exists(record)):
                raise RepositoryError("Smoke deletion verification failed.")
            if repository.count_frames(session_b) != 1:
                raise RepositoryError("Smoke deletion affected another session.")
            print("Targeted deletion verified; other test records remain intact")
    finally:
        if ids:
            with Database(settings) as database:
                repository = FrameRepository.from_database(database)
                for frame_id in ids:
                    repository.delete_frame(frame_id)
            print("Cleaned up only this smoke test's frame IDs and JPEGs")
    print("Database smoke test passed; no AI requests were made")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", help="Read-only persistence check for one UUID")
    args = parser.parse_args(argv)
    try:
        if args.verify:
            with Database() as database:
                if FrameRepository.from_database(database).get_frame(args.verify) is None:
                    raise RepositoryError("Persistence record not found.")
            print("Persistence record found")
        else:
            run_smoke_test()
        return 0
    except (DatabaseError, ValueError, TypeError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
