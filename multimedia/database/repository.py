"""Transactional metadata repository with private UUID-named JPEG storage."""

import argparse
import os
import sys
import hashlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import islice
from numbers import Integral
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import func, literal_column, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from processing.image_utils import encode_jpeg

from .errors import (DatabaseError, DuplicateFrameError, ImageStorageError,
                     RepositoryError, StorageConsistencyError)
from .models import Account, EMBEDDING_DIMENSIONS, Frame, LoginSession, StreamSession
from .validation import as_utc, as_uuid, optional_position, validate_embedding, video_milliseconds


@dataclass(frozen=True)
class FrameRecord:
    """Internal metadata only; Task 12 must map paths to authorized image URLs."""
    frame_id: UUID
    session_id: UUID
    captured_at: datetime
    source_frame_index: int | None
    video_timestamp_ms: int | None
    image_path: str = field(repr=False)
    ocr_text: str
    objects: list[str]
    caption: str
    embedding: list[float] | None = field(repr=False)
    embedding_model: str | None
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class FrameCursor:
    captured_at: datetime
    frame_id: UUID


@dataclass(frozen=True)
class ExpiredFrame:
    frame_id: UUID
    expires_at: datetime


@dataclass(frozen=True)
class FrameDeletion:
    deleted: bool
    files_deleted: int = 0
    missing_file: bool = False


@dataclass(frozen=True)
class StoredEmbedding:
    model: str
    dimensions: int
    embedding: list[float] = field(repr=False)


@dataclass(frozen=True)
class SearchCandidate:
    """Read-only projection: no image bytes, private path or ORM identity state.

    Embeddings stay unvalidated here so one malformed legacy vector can be
    excluded by search without losing every other candidate in its batch.
    """
    frame_id: UUID
    session_id: UUID
    captured_at: datetime
    expires_at: datetime
    ocr_text: str
    objects: list[str]
    caption: str
    embedding: object = field(repr=False)
    embedding_model: str | None


def _record(row: Frame) -> FrameRecord:
    return FrameRecord(row.frame_id, row.session_id, as_utc(row.captured_at),
                       row.source_frame_index, row.video_timestamp_ms, row.image_path,
                       row.ocr_text, list(row.objects), row.caption,
                       validate_embedding(row.embedding, row.embedding_model), row.embedding_model,
                       as_utc(row.created_at, "created_at"), as_utc(row.expires_at, "expires_at"))


def _rollback(session):
    try:
        session.rollback()
    except Exception:
        pass  # Session close still releases the connection; never echo driver details.


class FrameRepository:
    def __init__(self, sessions, storage_root: str | Path, retention_hours: int = 24):
        if isinstance(retention_hours, bool) or not isinstance(retention_hours, Integral) or retention_hours <= 0:
            raise ValueError("retention_hours must be a positive integer.")
        self.sessions = sessions
        root = Path(storage_root)
        self.storage_root = (root if root.is_absolute() else Path(__file__).resolve().parents[1] / root).resolve()
        self.retention_hours = int(retention_hours)

    @classmethod
    def from_database(cls, database):
        return cls(database.sessions, database.settings.storage_root, database.settings.retention_hours)

    def _safe_path(self, relative: str) -> Path:
        candidate = Path(relative)
        if candidate.is_absolute() or candidate.drive or ".." in candidate.parts:
            raise ImageStorageError("Stored image path is not an approved private relative path.")
        path = (self.storage_root / candidate).resolve()
        if not path.is_relative_to(self.storage_root) or path == self.storage_root:
            raise ImageStorageError("Stored image path escapes the approved storage directory.")
        if path != self.storage_root / candidate:
            raise ImageStorageError("Stored image path redirects to another file or directory.")
        return path

    def _row_path(self, row: FrameRecord | Frame) -> Path:
        expected = f"{row.session_id}/{row.frame_id}.jpg"
        if row.image_path != expected:
            raise ImageStorageError("Stored image path does not match its session/frame UUIDs.")
        return self._safe_path(row.image_path)

    def _remove_created_image(self, path: Path, frame_id: UUID):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            raise StorageConsistencyError(f"Image cleanup failed for frame {frame_id}; local recovery is required.") from None

    def save_frame(self, session_id, captured_at, image, ocr_text="", objects=None, caption="",
                   embedding=None, embedding_model=None, *, frame_id=None,
                   source_frame_index=None, video_timestamp_ms=None) -> UUID:
        session_id = as_uuid(session_id, "session_id")
        frame_id = uuid4() if frame_id is None else as_uuid(frame_id, "frame_id")
        captured_at = as_utc(captured_at)
        source_frame_index = optional_position(source_frame_index, "source_frame_index")
        video_timestamp_ms = video_milliseconds(video_timestamp_ms)
        if not isinstance(ocr_text, str) or not isinstance(caption, str):
            raise TypeError("ocr_text and caption must be strings (empty strings are allowed).")
        objects = [] if objects is None else objects
        if not isinstance(objects, list) or any(not isinstance(label, str) or not label.strip() for label in objects):
            raise TypeError("objects must be a JSON-compatible list of nonempty strings.")
        embedding = validate_embedding(embedding, embedding_model)
        jpeg = encode_jpeg(image)
        relative = f"{session_id}/{frame_id}.jpg"
        path = self._safe_path(relative)
        created = committed = False
        try:
            self.storage_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self._safe_path(relative)  # Recheck parent links after creation.
            with path.open("xb") as output:
                created = True
                output.write(jpeg)
                output.flush()
                os.fsync(output.fileno())
            with self.sessions() as session:
                try:
                    session.add(Frame(
                        frame_id=frame_id, session_id=session_id, captured_at=captured_at,
                        source_frame_index=source_frame_index, video_timestamp_ms=video_timestamp_ms,
                        image_path=relative, ocr_text=ocr_text, objects=list(objects), caption=caption,
                        embedding=embedding, embedding_model=embedding_model,
                        expires_at=func.timestampadd(literal_column("HOUR"), self.retention_hours,
                                                     literal_column("UTC_TIMESTAMP(6)")),
                    ))
                    session.flush()
                except SQLAlchemyError:
                    _rollback(session)
                    raise
                try:
                    session.commit()
                    committed = True
                except Exception:
                    _rollback(session)
                    raise StorageConsistencyError(
                        f"Save commit outcome uncertain for frame {frame_id}; its JPEG was retained for recovery."
                    ) from None
            return frame_id
        except StorageConsistencyError:
            raise
        except FileExistsError:
            raise DuplicateFrameError("A JPEG already exists for this frame ID; nothing was overwritten.") from None
        except SQLAlchemyError as error:
            if created and not committed:
                self._remove_created_image(path, frame_id)
            if committed:
                raise StorageConsistencyError(f"Frame {frame_id} was committed; connection cleanup failed, JPEG retained.") from None
            if isinstance(error, IntegrityError) and getattr(error.orig, "args", ())[:1] == (1062,):
                raise DuplicateFrameError("Frame ID or image path already exists; nothing was overwritten.") from None
            raise RepositoryError("Frame insertion failed and was rolled back; database details were suppressed.") from None
        except OSError:
            if committed:
                raise StorageConsistencyError(f"Frame {frame_id} was committed; resource cleanup failed, JPEG retained.") from None
            if created:
                self._remove_created_image(path, frame_id)
            raise ImageStorageError("Could not write the private JPEG; no database record was inserted.") from None

    def get_frame(self, frame_id) -> FrameRecord | None:
        frame_id = as_uuid(frame_id, "frame_id")
        try:
            with self.sessions() as session:
                row = session.get(Frame, frame_id)
                return _record(row) if row is not None else None
        except SQLAlchemyError:
            raise RepositoryError("Frame retrieval failed; database details were suppressed.") from None

    def list_frames(self, session_id, limit=20, *, before: FrameCursor | None = None) -> list[FrameRecord]:
        session_id = as_uuid(session_id, "session_id")
        if isinstance(limit, bool) or not isinstance(limit, Integral) or not 1 <= limit <= 1000:
            raise ValueError("limit must be an integer from 1 to 1000.")
        query = select(Frame).where(Frame.session_id == session_id)
        if before is not None:
            if not isinstance(before, FrameCursor):
                raise TypeError("before must be a FrameCursor.")
            capture = as_utc(before.captured_at)
            identifier = as_uuid(before.frame_id, "cursor.frame_id")
            query = query.where((Frame.captured_at < capture) |
                                ((Frame.captured_at == capture) & (Frame.frame_id < identifier)))
        query = query.order_by(Frame.captured_at.desc(), Frame.frame_id.desc()).limit(int(limit))
        try:
            with self.sessions() as session:
                return [_record(row) for row in session.scalars(query)]
        except SQLAlchemyError:
            raise RepositoryError("Session frame listing failed; database details were suppressed.") from None

    def count_frames(self, session_id) -> int:
        session_id = as_uuid(session_id, "session_id")
        try:
            with self.sessions() as session:
                return session.scalar(select(func.count()).select_from(Frame).where(Frame.session_id == session_id))
        except SQLAlchemyError:
            raise RepositoryError("Session frame count failed; database details were suppressed.") from None

    def iter_search_candidates(self, session_id, start_time=None, end_time=None, *, now=None, batch_size=128, before=None):
        """Keyset pagination over retained metadata; close each session before yielding.

        Capture bounds are inclusive; expiry is strictly greater than the
        supplied request time. No total-row cap or image filesystem access.
        """
        session_id = as_uuid(session_id, "session_id")
        now = as_utc(datetime.now(UTC) if now is None else now, "now")
        start_time = None if start_time is None else as_utc(start_time, "start_time")
        end_time = None if end_time is None else as_utc(end_time, "end_time")
        if start_time is not None and end_time is not None and start_time > end_time:
            raise ValueError("start_time must not be after end_time.")
        if isinstance(batch_size, bool) or not isinstance(batch_size, Integral) or not 1 <= batch_size <= 1000:
            raise ValueError("batch_size must be an integer from 1 to 1000.")
        initial_cursor = None
        if before is not None:
            if not isinstance(before, FrameCursor):
                raise TypeError("before must be a FrameCursor.")
            initial_cursor = (as_utc(before.captured_at), as_uuid(before.frame_id, "cursor.frame_id"))

        def iterate():
            cursor = initial_cursor
            while True:
                query = select(*(getattr(Frame, name) for name in SearchCandidate.__dataclass_fields__))
                query = query.where(Frame.session_id == session_id, Frame.expires_at > now)
                if start_time is not None:
                    query = query.where(Frame.captured_at >= start_time)
                if end_time is not None:
                    query = query.where(Frame.captured_at <= end_time)
                if cursor is not None:
                    capture, identifier = cursor
                    query = query.where((Frame.captured_at < capture) |
                                        ((Frame.captured_at == capture) & (Frame.frame_id < identifier)))
                query = query.order_by(Frame.captured_at.desc(), Frame.frame_id.desc()).limit(int(batch_size))
                try:
                    with self.sessions() as session:
                        rows = session.execute(query).mappings().all()
                except SQLAlchemyError:
                    raise RepositoryError("Search candidate retrieval failed; database details were suppressed.") from None
                if not rows:
                    return
                # Advance using database ordering, independently of vector validity.
                cursor = (rows[-1]["captured_at"], rows[-1]["frame_id"])
                for row in rows:
                    yield SearchCandidate(**row)
                if len(rows) < batch_size:
                    return

        return iterate()

    def list_timeline_frames(self, session_id, limit=20, *, before=None, now=None):
        """Read a bounded, unexpired timeline without JPEG or vector validation."""
        if isinstance(limit, bool) or not isinstance(limit, Integral) or not 1 <= limit <= 101:
            raise ValueError("Timeline fetch limit must be an integer from 1 to 101.")
        now = as_utc(datetime.now(UTC) if now is None else now, "now")
        iterator = self.iter_search_candidates(session_id, end_time=now, now=now,
                                               batch_size=int(limit), before=before)
        try:
            return list(islice(iterator, int(limit)))
        finally:
            iterator.close()

    def has_account(self, user_id) -> bool:
        user_id = as_uuid(user_id, "user_id")
        try:
            with self.sessions() as session:
                return session.scalar(select(Account.user_id).where(Account.user_id == user_id)) is not None
        except SQLAlchemyError:
            raise RepositoryError("Account lookup failed; database details were suppressed.") from None

    def session_owned_by(self, session_id, user_id) -> bool:
        session_id, user_id = as_uuid(session_id, "session_id"), as_uuid(user_id, "user_id")
        try:
            with self.sessions() as session:
                return session.scalar(select(StreamSession.session_id).where(
                    StreamSession.session_id == session_id, StreamSession.user_id == user_id)) is not None
        except SQLAlchemyError:
            raise RepositoryError("Session access lookup failed; database details were suppressed.") from None

    def get_refresh_user(self, token_hash, *, now, max_age):
        """Read the existing backend's hashed refresh sessions; never issue tokens."""
        if not isinstance(token_hash, str) or len(token_hash) != 64 or any(c not in "0123456789abcdef" for c in token_hash):
            raise ValueError("Invalid refresh token hash.")
        now = as_utc(now, "now")
        try:
            with self.sessions() as session:
                return session.scalar(select(LoginSession.user_id).where(
                    LoginSession.token_hash == token_hash, LoginSession.expires_at > now,
                    LoginSession.created_at > now - max_age, LoginSession.created_at <= now))
        except SQLAlchemyError:
            raise RepositoryError("Authentication lookup failed; database details were suppressed.") from None

    def load_frame_image(self, frame_id) -> bytes | None:
        row = self.get_frame(frame_id)
        if row is None:
            return None
        path = self._row_path(row)
        try:
            return path.read_bytes()
        except OSError:
            raise ImageStorageError("The frame exists but its private JPEG is unavailable.") from None

    def get_embedding(self, frame_id) -> StoredEmbedding | None:
        row = self.get_frame(frame_id)
        if row is None or row.embedding is None:
            return None
        return StoredEmbedding(row.embedding_model, EMBEDDING_DIMENSIONS, row.embedding)

    @contextmanager
    def retention_lock(self):
        """Connection-owned MySQL lock, shared by workers using this database.

        A separate connection holds the advisory lock across bounded transactions.
        Return it to the pool only after release; invalidate on uncertain release.
        """
        connection = self.sessions.kw["bind"].connect()
        acquired = False
        try:
            name = "aether-retention-" + hashlib.sha256(
                str(connection.scalar(text("SELECT DATABASE()"))).encode()).hexdigest()[:40]
            acquired = connection.scalar(text("SELECT GET_LOCK(:name, 0)"), {"name": name}) == 1
            if not acquired:
                raise RepositoryError("Another retention worker holds the database cleanup lock.")
            yield
        except SQLAlchemyError:
            raise RepositoryError("Retention coordination failed; database details were suppressed.") from None
        finally:
            if acquired:
                try:
                    if connection.scalar(text("SELECT RELEASE_LOCK(:name)"), {"name": name}) != 1:
                        connection.invalidate()
                except Exception:
                    connection.invalidate()
            connection.close()

    def iter_expired_frames(self, now, *, batch_size=100, session_id=None):
        """Keyset pages of IDs/expiry only. No images or vectors loaded."""
        now = as_utc(now, "now")
        if type(batch_size) is not int or not 1 <= batch_size <= 1000:
            raise ValueError("batch_size must be an integer from 1 to 1000.")
        sid = None if session_id is None else as_uuid(session_id, "session_id")
        before = None
        while True:
            query = select(Frame.frame_id, Frame.expires_at).where(Frame.expires_at <= now)
            if sid is not None:
                query = query.where(Frame.session_id == sid)
            if before is not None:
                expiry, identifier = before
                query = query.where((Frame.expires_at > expiry) |
                                    ((Frame.expires_at == expiry) & (Frame.frame_id > identifier)))
            query = query.order_by(Frame.expires_at, Frame.frame_id).limit(batch_size)
            try:
                with self.sessions() as session:
                    rows = session.execute(query).all()
            except SQLAlchemyError:
                raise RepositoryError("Could not read expired frames; database details were suppressed.") from None
            if not rows:
                return
            for identifier, expiry in rows:
                yield ExpiredFrame(identifier, as_utc(expiry, "expires_at"))
            before = (rows[-1][1], rows[-1][0])

    def delete_expired_frame(self, frame_id, now) -> FrameDeletion:
        return self._delete_frame(frame_id, expires_before=as_utc(now, "now"))

    def delete_frame(self, frame_id) -> bool:
        return self._delete_frame(frame_id).deleted

    def _delete_frame(self, frame_id, *, expires_before=None) -> FrameDeletion:
        frame_id = as_uuid(frame_id, "frame_id")
        path = quarantine = None
        commit_started = committed = False
        try:
            with self.sessions() as session:
                try:
                    row = session.scalar(select(Frame).where(Frame.frame_id == frame_id).with_for_update())
                    if row is None or (expires_before is not None and as_utc(row.expires_at) > expires_before):
                        return FrameDeletion(False)
                    path = self._row_path(row)
                    if path.exists():
                        quarantine = path.with_name(f".{frame_id}.deleted-{uuid4()}.jpg")
                        path.rename(quarantine)
                    session.delete(row)
                    session.flush()
                    commit_started = True
                    session.commit()
                    committed = True
                except SQLAlchemyError:
                    _rollback(session)
                    raise
            if quarantine is not None:
                quarantine.unlink()
            return FrameDeletion(True, int(quarantine is not None), quarantine is None)
        except (SQLAlchemyError, OSError):
            if commit_started:
                outcome = "committed" if committed else "uncertain"
                raise StorageConsistencyError(
                    f"Delete {outcome} for frame {frame_id}; any quarantined JPEG was retained for local recovery."
                ) from None
            if quarantine is not None and quarantine.exists():
                try:
                    quarantine.rename(path)
                except OSError:
                    raise StorageConsistencyError(f"Delete rollback image restoration failed for frame {frame_id}.") from None
            raise RepositoryError("Frame deletion failed; transaction rolled back and any moved JPEG was restored.") from None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke-test", action="store_true")
    args = parser.parse_args(argv)
    if not args.smoke_test:
        parser.error("Specify --smoke-test")
    try:
        from .smoke import run_smoke_test
        run_smoke_test()
        return 0
    except (DatabaseError, ValueError, TypeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
