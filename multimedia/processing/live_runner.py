"""Explicit bounded live worker: acquisition, latest-candidate queue, one analysis."""

import argparse
from contextlib import nullcontext
from dataclasses import dataclass, replace
from datetime import UTC, datetime
import json
import queue
import sys
import threading
import time
from uuid import uuid4

from database.validation import as_uuid, as_utc
from .live_settings import LiveSettings, StreamSettings
from .live_stream import RTSPFrameSource, StreamState
from .pipeline import MultimediaPipeline, ProcessingResult


class MonotonicSampler:
    def __init__(self, interval=1):
        from .live_settings import positive
        positive(interval, "sample_interval", 1, 3600)
        self.interval = interval
        self.last = None
        self.seen = None

    def accept(self, timestamp):
        import math
        if isinstance(timestamp, bool) or not isinstance(timestamp, (float, int)) or not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError("A finite monotonic arrival time is required.")
        if self.seen is not None and timestamp < self.seen:
            raise ValueError("Arrival monotonic time moved backward.")
        self.seen = timestamp
        if self.last is None or timestamp - self.last >= self.interval:
            self.last = timestamp
            return True
        return False


@dataclass
class LiveCounters:
    sampled_frames: int = 0
    queue_dropped_frames: int = 0
    stale_dropped_frames: int = 0
    shutdown_dropped_frames: int = 0
    frames_sent_to_analysis: int = 0
    last_frame_arrival_at: str | None = None
    last_saved_at: str | None = None
    last_queue_delay_seconds: float | None = None
    last_processing_latency_seconds: float | None = None
    error_type: str | None = None
    error_stage: str | None = None
    stop_reason: str | None = None


class LiveMultimediaRunner:
    _registry = set()
    _registry_lock = threading.Lock()

    def __init__(self, *, stream_source, pipeline, session_id=None, settings=None,
                 dry_run=True, clock=time.monotonic):
        self.session_id = as_uuid(stream_source.session_id if session_id is None else session_id, "session_id")
        if self.session_id != stream_source.session_id:
            raise ValueError("Source and pipeline session IDs must match.")
        if not callable(getattr(pipeline, "process_live_frame", None)):
            raise TypeError("Task 13 pipeline.process_live_frame is required.")
        if type(dry_run) is not bool:
            raise TypeError("dry_run must be a boolean.")
        self.source, self.pipeline = stream_source, pipeline
        self.settings = settings if settings is not None else LiveSettings()
        if not isinstance(self.settings, LiveSettings):
            raise TypeError("settings must be LiveSettings.")
        self.dry_run, self.clock = dry_run, clock
        self.queue = queue.Queue(self.settings.queue_size)
        self.sampler = MonotonicSampler(self.settings.sample_interval_seconds)
        self.stop_event = threading.Event()
        self.acquisition_done = threading.Event()
        self._lock = threading.RLock()
        self.counters = LiveCounters()
        self.processing = ProcessingResult(str(self.session_id), dry_run, pipeline.mocked, "receiver_arrival_utc")
        self.state = StreamState.DISCONNECTED
        self._began = self._ended = None
        self._origin = None
        self._failure_streak = 0
        self._coordinator = None
        self._workers = []
        self._used = False

    def _reserve(self):
        with self._registry_lock:
            if self._used or self.session_id in self._registry:
                raise RuntimeError("A live runner for this session is already active in this process, or this instance was used.")
            self._registry.add(self.session_id)
            self._used = True

    def start(self):
        """Start only when explicitly requested; wait() joins the coordinator."""
        self._reserve()
        self._coordinator = threading.Thread(target=self._run_reserved, name="aether-live-coordinator")
        self._coordinator.start()
        return self

    def stop(self, reason="manual"):
        with self._lock:
            if self.counters.stop_reason is None:
                self.counters.stop_reason = reason
        self.stop_event.set()

    def wait(self, timeout=None):
        if self._coordinator is not None:
            self._coordinator.join(timeout)
            if self._coordinator.is_alive():
                raise TimeoutError("Live runner is still finishing its in-flight operation.")
        return self.snapshot()

    def run(self):
        self._reserve()
        return self._run_reserved()

    def _fail(self, stage, error):
        with self._lock:
            self.counters.error_type = type(error).__name__
            self.counters.error_stage = stage
            self.state = StreamState.FAILED
            self.counters.stop_reason = "failure"
        self.stop_event.set()

    def _offer(self, frame):
        try:
            self.queue.put_nowait(frame)
        except queue.Full:
            try:
                self.queue.get_nowait()
                with self._lock:
                    self.counters.queue_dropped_frames += 1
            except queue.Empty:
                pass
            # One acquisition producer; only the analysis consumer can remove.
            self.queue.put_nowait(frame)

    def _acquire(self):
        iterator = None
        try:
            iterator = self.source.frames(self.stop_event)
            for frame in iterator:
                if self.stop_event.is_set():
                    break
                if frame.session_id != self.session_id:
                    raise ValueError("Source returned a different session.")
                with self._lock:
                    self.counters.last_frame_arrival_at = as_utc(frame.arrived_at).isoformat().replace("+00:00", "Z")
                if self.sampler.accept(frame.monotonic_time):
                    with self._lock:
                        self.counters.sampled_frames += 1
                    self._offer(frame)
        except Exception as error:
            if not self.stop_event.is_set():
                self._fail("acquisition", error)
        finally:
            try:
                if iterator is not None:
                    close = getattr(iterator, "close", None)
                    if callable(close):
                        close()
                self.source.close()
            except Exception as error:
                self._fail("capture_shutdown", error)
            self.acquisition_done.set()

    def _analyze_frame(self, frame):
        started = self.clock()
        age = started - frame.monotonic_time
        if age < 0 or age > self.settings.max_candidate_age_seconds:
            with self._lock:
                self.counters.stale_dropped_frames += 1
            return
        if self._origin is None:
            self._origin = frame.monotonic_time
        with self._lock:
            self.counters.frames_sent_to_analysis += 1
            self.counters.last_queue_delay_seconds = round(age, 6)
        outcome = self.pipeline.process_live_frame(frame.image, self.session_id,
            captured_at=frame.arrived_at, source_frame_index=frame.sequence,
            elapsed_ms=(frame.monotonic_time - self._origin) * 1000, dry_run=self.dry_run)
        with self._lock:
            self.processing.add(outcome)
            # Long sessions retain bounded operational detail, not every outcome.
            self.processing.outcomes[:] = self.processing.outcomes[-100:]
            self.processing.frame_ids[:] = self.processing.frame_ids[-100:]
            self.counters.last_processing_latency_seconds = round(max(0, self.clock() - frame.monotonic_time), 6)
            if outcome.frame_id:
                self.counters.last_saved_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            if outcome.status == "failed":
                self._failure_streak += 1
            elif outcome.accepted:
                self._failure_streak = 0
            if outcome.fatal or self._failure_streak >= self.settings.max_consecutive_failures:
                self.counters.error_type = outcome.error_type
                self.counters.error_stage = outcome.error_stage
                self.counters.stop_reason = "failure"
                self.processing.fatal_error = outcome.error_type
                self.state = StreamState.FAILED
                self.stop_event.set()
            if self.processing.selected_frames >= self.settings.max_accepted_frames:
                self.stop("max_accepted_frames")

    def _analyze(self):
        next_start = self.clock()
        try:
            while not self.stop_event.is_set():
                delay = max(0, next_start - self.clock())
                if delay and self.stop_event.wait(delay):
                    break
                try:
                    frame = self.queue.get(timeout=.05)
                except queue.Empty:
                    if self.acquisition_done.is_set():
                        break
                    continue
                self._analyze_frame(frame)
                # Also rate-limit selection starts, preventing a post-backlog
                # burst even though acquisition sampling already uses arrivals.
                next_start = self.clock() + self.settings.sample_interval_seconds
        except Exception as error:
            self._fail("analysis", error)
        finally:
            self.stop("source_ended")

    def _run_reserved(self):
        self._began = self.clock()
        self.state = StreamState.CONNECTING
        try:
            self.pipeline.selector.reset()
            self._workers = [threading.Thread(target=self._acquire, name="aether-live-acquisition"),
                             threading.Thread(target=self._analyze, name="aether-live-analysis")]
            for worker in self._workers:
                worker.start()
            while not self.stop_event.wait(.05):
                if self.clock() - self._began >= self.settings.duration_seconds:
                    self.stop("duration_limit")
        except KeyboardInterrupt:
            self.stop()
        except Exception as error:
            self._fail("runner", error)
        finally:
            self.stop()
            if self.state != StreamState.FAILED:
                self.state = StreamState.STOPPING
            # Acquisition only blocks on cancellable IPC. Analysis finishes the
            # current bounded provider/DB workflow; never kill a transaction.
            for worker in self._workers:
                if worker.ident is not None:
                    worker.join()
            try:
                self.source.close()
            except Exception as error:
                self._fail("capture_shutdown", error)
            while True:
                try:
                    self.queue.get_nowait()
                    self.counters.shutdown_dropped_frames += 1
                except queue.Empty:
                    break
            self._ended = self.clock()
            if self.counters.stop_reason == "duration_limit" and self.source.snapshot()["decoded_frames"] == 0:
                self.counters.error_stage = "acquisition"
                self.counters.error_type = "NoDecodedFrames"
                self.state = StreamState.FAILED
            if self.state != StreamState.FAILED:
                self.state = StreamState.STOPPED
            with self._registry_lock:
                self._registry.discard(self.session_id)
        return self.snapshot()

    def snapshot(self):
        from dataclasses import asdict
        with self._lock:
            report = asdict(self.counters)
            report.update(self.source.snapshot())
            report["state"] = str(self.state if self.state in (StreamState.STOPPED, StreamState.FAILED, StreamState.STOPPING)
                                  else self.source.state)
            report["session_id"] = str(self.session_id)
            report["queue_depth"] = self.queue.qsize()
            report["queue_capacity"] = self.settings.queue_size
            report["runtime_seconds"] = round((self._ended or self.clock()) - self._began, 6) if self._began is not None else 0
            report["processing"] = self.processing.to_dict()
            report["processing"]["duration_seconds"] = report["runtime_seconds"]
            report["processing"]["total_decoded_frames"] = report["decoded_frames"]
            report["processing"]["details_truncated"] = self.processing.sampled_frames > 100 or self.processing.saved_frames > 100
            return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id")
    parser.add_argument("--host", help="Trusted operator override, never an HTTP parameter")
    parser.add_argument("--port", type=int)
    parser.add_argument("--duration-seconds", type=float)
    parser.add_argument("--max-accepted-frames", type=int)
    parser.add_argument("--interval", type=float)
    parser.add_argument("--queue-size", type=int)
    provider = parser.add_mutually_exclusive_group(required=True)
    provider.add_argument("--offline-demo", action="store_true", help="Explicitly MOCKED AI; synthetic source unless --rtsp")
    provider.add_argument("--live", action="store_true", help="Allow bounded paid AI with actual RTSP")
    parser.add_argument("--rtsp", action="store_true", help="Real RTSP acquisition with --offline-demo mocked AI")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true", help="No persistence (default); --live still makes paid calls")
    action.add_argument("--execute", action="store_true", help="Explicitly persist accepted frames")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    runner = None
    try:
        defaults = LiveSettings.from_env()
        if args.interval is not None:
            from .live_settings import positive
            positive(args.interval, "interval", 1, 3600)
        settings = replace(defaults,
            duration_seconds=defaults.duration_seconds if args.duration_seconds is None else args.duration_seconds,
            max_accepted_frames=defaults.max_accepted_frames if args.max_accepted_frames is None else args.max_accepted_frames,
            sample_interval_seconds=defaults.sample_interval_seconds if args.interval is None else max(defaults.sample_interval_seconds, args.interval),
            queue_size=defaults.queue_size if args.queue_size is None else args.queue_size)
        sid = as_uuid(uuid4() if args.session_id is None else args.session_id, "session_id")
        from database.connection import Database
        from database.repository import FrameRepository
        if args.offline_demo:
            from .pipeline_demo import MockOCR, MockVision, MockEmbedding
            ocr, vision, embedding = MockOCR(), MockVision(), MockEmbedding()
        else:
            from .ocr_service import OCRService
            from .object_detector import VisionService
            from .embedding_service import EmbeddingService
            ocr, vision, embedding = OCRService(), VisionService(), EmbeddingService()
            if not all(isinstance(key, str) and key.strip() for key in (ocr._api_key, vision._api_key, embedding._api_key)):
                raise ValueError("Live providers require the established private API keys.")
        if args.live or args.rtsp:
            source = RTSPFrameSource(sid, settings=StreamSettings.from_env(), host=args.host, port=args.port)
        else:
            if args.host is not None or args.port is not None:
                raise ValueError("Host/port overrides require RTSP mode.")
            from .live_demo import SyntheticFrameSource
            source = SyntheticFrameSource(sid)
        context = Database() if args.execute or args.live else nullcontext(None)
        with context as database:
            if database is not None:
                database.check()
            repository = FrameRepository.from_database(database) if args.execute else None
            pipeline = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
                repository=repository, mocked=args.offline_demo)
            runner = LiveMultimediaRunner(stream_source=source, pipeline=pipeline,
                settings=settings, dry_run=not args.execute)
            runner.start()
            last_progress = -5
            try:
                while runner._coordinator.is_alive():
                    runner._coordinator.join(.25)
                    snapshot = runner.snapshot()
                    if args.verbose and snapshot["runtime_seconds"] - last_progress >= 5:
                        last_progress = snapshot["runtime_seconds"]
                        print(json.dumps({"event": "progress", "session_id": str(sid),
                            "state": snapshot["state"], "decoded_frames": snapshot["decoded_frames"],
                            "sampled_frames": snapshot["sampled_frames"], "queue_depth": snapshot["queue_depth"],
                            "saved_frames": snapshot["processing"]["saved_frames"]}), flush=True)
            except KeyboardInterrupt:
                runner.stop()
            report = runner.wait()
        print(json.dumps(report, ensure_ascii=True, indent=2))
        return int(report["state"] == "FAILED" or report["processing"]["failed_frames"] > 0)
    except KeyboardInterrupt:
        if runner is not None:
            runner.stop()
            runner.wait()
        return 130
    except Exception as error:
        if runner is not None:
            runner.stop()
            runner.wait()
        print(f"Live runner failed ({type(error).__name__}); private details suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
