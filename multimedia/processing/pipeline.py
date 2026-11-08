"""Sequential local-video orchestration over Tasks 2-10. No import side effects."""

import argparse
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
import json
import math
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

from dotenv import dotenv_values

from database.errors import DatabaseConnectionError, StorageConsistencyError
from database.validation import as_utc, as_uuid, validate_embedding, video_milliseconds
from .caption_service import get_caption
from .embedding_service import (DEFAULT_MODEL, EmbeddingResult, EmbeddingService,
                                EmbeddingAuthenticationError, EmbeddingConfigurationError,
                                EmbeddingRateLimitError, build_frame_description)
from .frame_extractor import ExtractedFrame, FrameExtractor
from .frame_selector import FrameSelector
from .object_detector import (VisionService, VisionAuthenticationError,
                              VisionConfigurationError, VisionRateLimitError)
from .ocr_service import (OCRResult, OCRService, OCRAuthenticationError,
                         OCRConfigurationError, OCRRateLimitError)

_FRAME_VIDEO_TIME = object()


@dataclass(frozen=True)
class PipelineSettings:
    sample_interval_seconds: float = 1
    max_test_frames: int = 5

    def __post_init__(self):
        if isinstance(self.sample_interval_seconds, bool) or not isinstance(self.sample_interval_seconds, (float, int)) or not math.isfinite(self.sample_interval_seconds) or self.sample_interval_seconds < 1:
            raise ValueError("sample_interval_seconds must be finite and at least 1 second.")
        if type(self.max_test_frames) is not int or not 1 <= self.max_test_frames <= 10000:
            raise ValueError("max_test_frames must be an integer from 1 to 10000.")

    @classmethod
    def from_env(cls):
        values = dotenv_values(Path(__file__).resolve().parents[1] / "api" / ".env", interpolate=False)
        return cls(float(os.environ.get("PIPELINE_SAMPLE_INTERVAL_SECONDS", values.get("PIPELINE_SAMPLE_INTERVAL_SECONDS", "1"))),
                   int(os.environ.get("PIPELINE_MAX_TEST_FRAMES", values.get("PIPELINE_MAX_TEST_FRAMES", "5"))))


@dataclass
class FrameOutcome:
    source_frame_index: int
    video_timestamp_ms: int | None
    accepted: bool = False
    selection_reason: str | None = None
    frame_id: str | None = None
    status: str = "rejected"
    # Reports contain status/uncertainty, never image bytes, OCR or vectors.
    stages: dict[str, str] = field(default_factory=dict)
    vision_uncertain: bool | None = None
    error_stage: str | None = None
    error_type: str | None = None
    fatal: bool = False


@dataclass
class ProcessingResult:
    session_id: str
    dry_run: bool
    mocked: bool
    capture_time_basis: str
    total_decoded_frames: int = 0
    sampled_frames: int = 0
    selected_frames: int = 0
    rejected_frames: int = 0
    selection_failures: int = 0
    saved_frames: int = 0
    failed_frames: int = 0
    analyzed_frames: int = 0
    rejection_reasons: dict[str, int] = field(default_factory=dict)
    stage_counts: dict[str, dict[str, int]] = field(default_factory=lambda: {
        name: {"successes": 0, "failures": 0, "skipped": 0} for name in ("ocr", "vision", "embedding", "storage")})
    frame_ids: list[str] = field(default_factory=list)
    outcomes: list[FrameOutcome] = field(default_factory=list)
    duration_seconds: float = 0
    fatal_error: str | None = None

    def to_dict(self):
        return asdict(self)

    def add(self, outcome):
        self.outcomes.append(outcome)
        self.sampled_frames += 1
        self.selected_frames += int(outcome.accepted)
        self.rejected_frames += int(not outcome.accepted and outcome.status == "rejected")
        self.failed_frames += int(outcome.status == "failed")
        self.selection_failures += int(outcome.error_stage == "selection")
        self.analyzed_frames += int(outcome.status in ("saved", "dry_run"))
        if outcome.status == "rejected":
            reason = outcome.selection_reason
            self.rejection_reasons[reason] = self.rejection_reasons.get(reason, 0) + 1
        if outcome.frame_id:
            self.saved_frames += 1
            self.frame_ids.append(outcome.frame_id)
        for name, status in outcome.stages.items():
            self.stage_counts[name][{"success": "successes", "failed": "failures", "skipped": "skipped"}[status]] += 1


class MultimediaPipeline:
    """Caller-owned dependencies. One instance/run at a time, reset per video.

    Fail-closed analysis: OCR/Vision/embedding failure skips persistence for that
    frame. Successful empty OCR is a success. Successful empty metadata stores
    NULL embedding/model. No implicit retries or partial-analysis rows.
    Reprocessing generates new UUIDs; selection is within-run, not dedup across
    runs. Storage uncertainty stops the run and preserves recovery evidence.
    """

    def __init__(self, *, ocr_service, vision_service, embedding_service,
                 repository=None, frame_selector=None, frame_extractor=FrameExtractor,
                 settings=None, clock=None, mocked=False):
        self.settings = settings if settings is not None else PipelineSettings()
        if not isinstance(self.settings, PipelineSettings):
            raise TypeError("settings must be PipelineSettings.")
        for service, method in ((ocr_service, "extract_text"), (vision_service, "analyze_image"),
                                (embedding_service, "embed_frame")):
            if not callable(getattr(service, method, None)):
                raise TypeError(f"Dependency must implement {method}.")
        self.ocr = ocr_service
        self.vision = vision_service
        self.embedding = embedding_service
        self.repository = repository
        self.selector = frame_selector if frame_selector is not None else FrameSelector()
        if not callable(getattr(self.selector, "evaluate", None)) or not callable(getattr(self.selector, "reset", None)) or not callable(frame_extractor):
            raise TypeError("A reusable selector and callable extractor factory are required.")
        if repository is not None and not callable(getattr(repository, "save_frame", None)):
            raise TypeError("repository must implement save_frame.")
        if repository is not None and isinstance(getattr(repository, "retention_hours", None), int) and repository.retention_hours != 24:
            raise ValueError("Task 13 requires insertion-based 24-hour retention.")
        self.extractor_factory = frame_extractor
        self.clock = clock or (lambda: datetime.now(UTC))
        self.mocked = bool(mocked)

    def process_live_frame(self, image, session_id, *, captured_at, source_frame_index, elapsed_ms, dry_run=False):
        """Receiver arrival UTC is capture evidence; monotonic elapsed time is
        used only by selection, never stored as a prerecorded-video timestamp.
        """
        frame = ExtractedFrame("live_receiver", source_frame_index, elapsed_ms, image)
        return self.process_frame(frame, session_id, captured_at=captured_at,
                                  dry_run=dry_run, video_timestamp_ms=None)

    def process_frame(self, frame: ExtractedFrame, session_id, *, captured_at=None, dry_run=False,
                      video_timestamp_ms=_FRAME_VIDEO_TIME):
        """Reuse with already-decoded frames; caller manages selector reset/order.

        Explicit absolute captured_at (or ExtractedFrame.captured_at) is required.
        No acquisition, RTSP, endpoints or frame persistence outside repository.
        """
        sid = as_uuid(session_id, "session_id")
        if type(dry_run) is not bool:
            raise TypeError("dry_run must be a boolean.")
        if not dry_run and self.repository is None:
            raise ValueError("A repository is required for persistence.")
        capture = as_utc(frame.captured_at if captured_at is None else captured_at)
        video_time = frame.timestamp_ms if video_timestamp_ms is _FRAME_VIDEO_TIME else video_timestamp_ms
        outcome = FrameOutcome(frame.frame_index, video_milliseconds(video_time))
        stage = "selection"
        try:
            decision = self.selector.evaluate(frame)
            outcome.accepted, outcome.selection_reason = decision.accepted, decision.reason
            if not decision.accepted:
                return outcome
            stage = "ocr"
            ocr = self.ocr.extract_text(frame.frame)
            if not isinstance(ocr, OCRResult) or not isinstance(ocr.text, str) or type(ocr.has_text) is not bool or ocr.has_text != bool(ocr.text.strip()):
                raise ValueError("Invalid Task 7 OCR result.")
            outcome.stages[stage] = "success"
            stage = "vision"
            vision = self.vision.analyze_image(frame.frame)
            caption = get_caption(vision)
            if not isinstance(caption, str) or not isinstance(vision.objects, list) or any(not isinstance(label, str) or not label.strip() for label in vision.objects) or type(vision.uncertain) is not bool:
                raise ValueError("Invalid Task 8 vision result.")
            outcome.vision_uncertain = vision.uncertain
            outcome.stages[stage] = "success"
            stage = "embedding"
            description = build_frame_description(ocr.text, vision.objects, caption)
            vector = model = None
            if description:
                embedding = self.embedding.embed_frame(ocr_text=ocr.text, objects=vision.objects, caption=caption)
                if not isinstance(embedding, EmbeddingResult) or embedding.dimensions != 1536 or embedding.source_text != description:
                    raise ValueError("Invalid Task 9 embedding result.")
                vector = validate_embedding(embedding.embedding, embedding.model)
                model = embedding.model
                if vector is None:
                    raise ValueError("Missing embedding for nonempty metadata.")
                outcome.stages[stage] = "success"
            else:
                outcome.stages[stage] = "skipped"
            stage = "storage"
            if dry_run:
                outcome.stages[stage] = "skipped"
                outcome.status = "dry_run"
            else:
                identifier = self.repository.save_frame(sid, capture, frame.frame, ocr_text=ocr.text,
                    objects=vision.objects, caption=caption, embedding=vector, embedding_model=model,
                    source_frame_index=frame.frame_index, video_timestamp_ms=video_time)
                outcome.frame_id = str(as_uuid(identifier, "frame_id"))
                outcome.stages[stage] = "success"
                outcome.status = "saved"
        except Exception as error:
            outcome.status = "failed"
            outcome.error_stage, outcome.error_type = stage, type(error).__name__
            if stage in ("ocr", "vision", "embedding", "storage"):
                outcome.stages[stage] = "failed"
            outcome.fatal = isinstance(error, (StorageConsistencyError, DatabaseConnectionError,
                OCRAuthenticationError, OCRConfigurationError, OCRRateLimitError,
                VisionAuthenticationError, VisionConfigurationError, VisionRateLimitError,
                EmbeddingAuthenticationError, EmbeddingConfigurationError, EmbeddingRateLimitError))
        return outcome

    def process_video(self, video_path, session_id=None, *, recording_start=None, dry_run=False):
        sid = as_uuid(uuid4() if session_id is None else session_id, "session_id")
        if type(dry_run) is not bool:
            raise TypeError("dry_run must be a boolean.")
        if not dry_run and self.repository is None:
            raise ValueError("A repository is required for persistence.")
        start = as_utc(self.clock() if recording_start is None else recording_start, "recording_start")
        result = ProcessingResult(str(sid), dry_run, self.mocked,
            "run_start_plus_video_offset_substitute" if recording_start is None else "provided_recording_start")
        began = time.monotonic()
        extractor = None
        try:
            self.selector.reset()
            with self.extractor_factory(video_path, interval=self.settings.sample_interval_seconds,
                    max_frames=self.settings.max_test_frames, recording_start=start) as extractor:
                frames = extractor.extract_frames()
                try:
                    for frame in frames:
                        capture = start + timedelta(milliseconds=frame.timestamp_ms)
                        outcome = self.process_frame(frame, sid, captured_at=capture, dry_run=dry_run)
                        result.add(outcome)
                        if outcome.fatal:
                            result.fatal_error = outcome.error_type
                            break
                finally:
                    close = getattr(frames, "close", None)
                    if callable(close):
                        close()
                if result.sampled_frames == 0:
                    result.fatal_error = "NoDecodableFrames"
        except Exception as error:
            result.fatal_error = type(error).__name__
        finally:
            if extractor is not None:
                result.total_decoded_frames = extractor.reader.frames_read
            result.duration_seconds = round(time.monotonic() - began, 6)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--session-id")
    parser.add_argument("--recording-start", help="Actual timezone-aware ISO recording start; otherwise labelled substitution")
    provider = parser.add_mutually_exclusive_group(required=True)
    provider.add_argument("--offline-demo", action="store_true", help="Deterministic MOCKED analysis, never cloud calls")
    provider.add_argument("--live", action="store_true", help="Explicitly allow bounded paid provider calls")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true", help="No JPEG/DB writes (default); --live still uses paid AI")
    action.add_argument("--execute", action="store_true", help="Persist selected frames with MySQL")
    parser.add_argument("--max-frames", type=int, help="Maximum sampled frames, including rejected samples")
    parser.add_argument("--interval", type=float)
    parser.add_argument("--verbose", action="store_true", help="Include safe frame-level status details")
    args = parser.parse_args(argv)
    try:
        defaults = PipelineSettings.from_env()
        settings = PipelineSettings(defaults.sample_interval_seconds if args.interval is None else args.interval,
                                    defaults.max_test_frames if args.max_frames is None else args.max_frames)
        sid = as_uuid(uuid4() if args.session_id is None else args.session_id, "session_id")
        start = None if args.recording_start is None else as_utc(args.recording_start, "recording_start")
        from database.connection import Database
        from database.repository import FrameRepository
        if args.offline_demo:
            from .pipeline_demo import MockOCR, MockVision, MockEmbedding
            ocr, vision, embedding = MockOCR(), MockVision(), MockEmbedding()
        else:
            ocr, vision, embedding = OCRService(), VisionService(), EmbeddingService()
            # Constructors make no requests. Fail before any billable work if
            # credentials are absent, using existing service configuration.
            if not ocr._api_key or not vision._api_key or not embedding._api_key:
                raise ValueError("Configured provider keys are required for --live.")
        context = Database() if args.execute or args.live else nullcontext(None)
        with context as database:
            if database is not None:
                database.check()
            repository = FrameRepository.from_database(database) if args.execute else None
            if repository is not None and repository.retention_hours != 24:
                raise ValueError("Task 13 requires FRAME_RETENTION_HOURS=24.")
            pipeline = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
                repository=repository, settings=settings, mocked=args.offline_demo)
            result = pipeline.process_video(args.video, sid, recording_start=start, dry_run=not args.execute)
        payload = result.to_dict()
        if not args.verbose:
            payload.pop("outcomes")
        print(json.dumps(payload, ensure_ascii=True, indent=2))
        return int(bool(result.fatal_error or result.failed_frames))
    except KeyboardInterrupt:
        print("Processing interrupted; committed frames remain retained.", file=sys.stderr)
        return 130
    except Exception as error:
        print(f"Pipeline failed ({type(error).__name__}); private details suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
