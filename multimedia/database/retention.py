"""Explicit, bounded cleanup of expired frames; no work starts on import."""

import argparse
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
import json
import math
import os
from pathlib import Path
import sys
import threading

from dotenv import dotenv_values

from .errors import StorageConsistencyError
from .validation import as_utc, as_uuid


@dataclass(frozen=True)
class RetentionSettings:
    batch_size: int = 100
    interval_minutes: float = 15

    def __post_init__(self):
        if type(self.batch_size) is not int or not 1 <= self.batch_size <= 1000:
            raise ValueError("batch_size must be an integer from 1 to 1000.")
        if isinstance(self.interval_minutes, bool) or not isinstance(self.interval_minutes, (float, int)) or not math.isfinite(self.interval_minutes) or not 0 < self.interval_minutes <= 10080:
            raise ValueError("interval_minutes must be finite, positive and at most one week.")

    @classmethod
    def from_env(cls):
        values = dotenv_values(Path(__file__).resolve().parents[1] / "api" / ".env", interpolate=False)
        return cls(int(os.environ.get("RETENTION_BATCH_SIZE", values.get("RETENTION_BATCH_SIZE", "100"))),
                   float(os.environ.get("RETENTION_CLEANUP_INTERVAL_MINUTES", values.get("RETENTION_CLEANUP_INTERVAL_MINUTES", "15"))))


@dataclass
class CleanupReport:
    dry_run: bool
    expired_records_found: int = 0
    records_deleted: int = 0
    files_deleted: int = 0
    missing_files: int = 0
    skipped_records: int = 0
    failures: int = 0
    stopped: bool = False
    # Cap details at 100; counters still cover the complete run.
    errors: list[dict] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)

    def fail(self, error, frame_id=None):
        self.failures += 1
        if len(self.errors) < 100:
            self.errors.append({"frame_id": str(frame_id) if frame_id else None,
                                "error_type": type(error).__name__})


def cleanup_expired_frames(repository, now_utc=None, batch_size=100, dry_run=True, *, session_id=None):
    """Global retention unless explicitly scoped to a session for controlled tests.

    Missing JPEG: delete its expired row and count missing_files. Failed deletes
    advance the keyset, rather than looping forever. Consistency uncertainty
    stops the cycle for local recovery. Never bypass repository path checks.
    """
    RetentionSettings(batch_size=batch_size)
    if type(dry_run) is not bool:
        raise TypeError("dry_run must be a boolean.")
    now = as_utc(datetime.now(UTC) if now_utc is None else now_utc, "now")
    sid = None if session_id is None else as_uuid(session_id, "session_id")
    report = CleanupReport(dry_run)
    try:
        with repository.retention_lock():
            iterator = repository.iter_expired_frames(now, batch_size=batch_size, session_id=sid)
            try:
                for candidate in iterator:
                    # Defensive check: the SQL predicate is also rechecked under
                    # the deletion row lock, including a concurrent expiry edit.
                    if as_utc(candidate.expires_at, "expires_at") > now:
                        report.skipped_records += 1
                        continue
                    report.expired_records_found += 1
                    if dry_run:
                        continue
                    try:
                        outcome = repository.delete_expired_frame(candidate.frame_id, now)
                        if outcome.deleted:
                            report.records_deleted += 1
                            report.files_deleted += outcome.files_deleted
                            report.missing_files += int(outcome.missing_file)
                        else:
                            report.skipped_records += 1
                    except Exception as error:
                        report.fail(error, candidate.frame_id)
                        if isinstance(error, StorageConsistencyError):
                            report.stopped = True
                            break
            finally:
                close = getattr(iterator, "close", None)
                if callable(close):
                    close()
    except Exception as error:
        report.fail(error)
        report.stopped = True
    return report


def run_worker(repository, settings, *, dry_run=True, session_id=None, stop_event=None, emit=print, clock=None):
    """Foreground process; interruptible wait, no shared SQLAlchemy Session."""
    stop = stop_event if stop_event is not None else threading.Event()
    clock = clock or (lambda: datetime.now(UTC))
    try:
        while not stop.is_set():
            report = cleanup_expired_frames(repository, clock(), settings.batch_size, dry_run, session_id=session_id)
            emit(json.dumps(report.to_dict()))
            if report.stopped:
                return 1
            stop.wait(settings.interval_minutes * 60)
    except KeyboardInterrupt:
        stop.set()
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--worker", action="store_true")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true", help="Preview only (default)")
    action.add_argument("--execute", action="store_true", help="Explicitly delete eligible records and JPEGs")
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--interval-minutes", type=float)
    parser.add_argument("--session-id", help="Optional scope for controlled test data; otherwise global")
    args = parser.parse_args(argv)
    try:
        defaults = RetentionSettings.from_env()
        settings = RetentionSettings(defaults.batch_size if args.batch_size is None else args.batch_size,
                                     defaults.interval_minutes if args.interval_minutes is None else args.interval_minutes)
        sid = None if args.session_id is None else as_uuid(args.session_id, "session_id")
        from .connection import Database
        from .repository import FrameRepository
        with Database() as database:
            database.check()
            repository = FrameRepository.from_database(database)
            if args.worker:
                return run_worker(repository, settings, dry_run=not args.execute, session_id=sid)
            report = cleanup_expired_frames(repository, batch_size=settings.batch_size,
                                            dry_run=not args.execute, session_id=sid)
            print(json.dumps(report.to_dict()))
            return int(report.failures > 0)
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        print(f"Retention failed ({type(error).__name__}); private details suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
