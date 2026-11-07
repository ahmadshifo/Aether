"""Actual OpenCV sampling/selection, injected Task 7-9 results, no network/DB."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import cv2
import numpy as np
import pytest

from database.errors import DatabaseConnectionError, ImageStorageError, RepositoryError, StorageConsistencyError
from processing.embedding_service import EmbeddingResult, build_frame_description
from processing.frame_extractor import ExtractedFrame, FrameExtractor
from processing.frame_selector import FrameSelector
from processing.object_detector import VisionResult
from processing.ocr_service import OCRResult
from processing.ocr_service import OCRRateLimitError
from processing.pipeline import MultimediaPipeline, PipelineSettings, main
from processing.pipeline_demo import MockEmbedding, MockOCR, MockVision, write_demo_video

NOW = datetime(2026, 11, 7, tzinfo=UTC)


@pytest.fixture(autouse=True)
def no_network():
    with patch("pymysql.connect", side_effect=AssertionError("No MySQL")), \
         patch("openai.OpenAI", side_effect=AssertionError("No provider")), \
         patch("processing.ocr_service.Mistral", side_effect=AssertionError("No provider")):
        yield


@pytest.fixture
def video(tmp_path):
    return write_demo_video(tmp_path / "scenes.avi")


@pytest.fixture
def parts():
    ocr = Mock(wraps=MockOCR())
    vision = Mock(wraps=MockVision())
    embedding = Mock(wraps=MockEmbedding())
    repository = Mock()
    repository.save_frame.side_effect = lambda *a, **k: uuid4()
    pipeline = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
        repository=repository, clock=lambda: NOW, mocked=True)
    return pipeline, ocr, vision, embedding, repository


@pytest.fixture
def frame():
    rng = np.random.default_rng(7)
    return ExtractedFrame("synthetic", 12, 1200.5, rng.integers(0, 256, (48, 64, 3), dtype=np.uint8), NOW.isoformat())


@pytest.mark.parametrize("interval,maximum", [(1, 5), (2.5, 2), (10, 100)])
def test_valid_settings(interval, maximum):
    assert PipelineSettings(interval, maximum).max_test_frames == maximum


@pytest.mark.parametrize("interval,maximum", [(0, 5), (.5, 5), (True, 5), (float("inf"), 5),
    (float("nan"), 5), (1, 0), (1, True), (1, 1.5), (1, 10001)])
def test_invalid_settings(interval, maximum):
    with pytest.raises(ValueError):
        PipelineSettings(interval, maximum)


def test_invalid_dependency_rejected():
    with pytest.raises(TypeError):
        MultimediaPipeline(ocr_service=object(), vision_service=MockVision(), embedding_service=MockEmbedding())


def test_real_video_selection_counts_and_no_rejected_calls(parts, video):
    pipeline, ocr, vision, embedding, repository = parts
    result = pipeline.process_video(video, uuid4(), recording_start=NOW)
    assert result.fatal_error is None
    assert (result.total_decoded_frames, result.sampled_frames, result.selected_frames, result.rejected_frames) == (40, 4, 2, 2)
    assert result.rejection_reasons == {"duplicate": 1, "blurry": 1}
    assert result.saved_frames == result.analyzed_frames == 2 and result.failed_frames == 0
    assert len(result.frame_ids) == 2 and len(set(result.frame_ids)) == 2
    assert ocr.extract_text.call_count == vision.analyze_image.call_count == embedding.embed_frame.call_count == repository.save_frame.call_count == 2
    assert result.stage_counts == {stage: {"successes": 2, "failures": 0, "skipped": 0} for stage in ("ocr", "vision", "embedding", "storage")}
    assert result.duration_seconds >= 0


def test_actual_extractor_invocation_sampling_limit_and_release(parts, video):
    pipeline = parts[0]
    pipeline.settings = PipelineSettings(2, 2)
    instances = []
    def factory(*args, **kwargs):
        instance = FrameExtractor(*args, **kwargs)
        instances.append(instance)
        return instance
    pipeline.extractor_factory = factory
    result = pipeline.process_video(video, dry_run=True)
    assert [o.source_frame_index for o in result.outcomes] == [0, 20]
    assert result.total_decoded_frames == 21
    assert instances[0].reader.capture is None
    assert instances[0].interval == 2 and instances[0].max_frames == 2


@pytest.mark.parametrize("kind", ["missing", "empty", "corrupt"])
def test_invalid_video_safe_report(parts, tmp_path, kind):
    path = tmp_path / f"{kind}.avi"
    if kind != "missing":
        path.write_bytes(b"" if kind == "empty" else b"invalid video")
    result = parts[0].process_video(path, dry_run=True)
    assert result.fatal_error and result.sampled_frames == result.saved_frames == 0
    parts[1].extract_text.assert_not_called()


def test_no_decodable_frames(parts, video):
    with patch.object(FrameExtractor, "extract_frames", return_value=iter(())):
        result = parts[0].process_video(video, dry_run=True)
    assert result.fatal_error == "NoDecodableFrames"


def test_metadata_unicode_and_exact_image_mapping(parts, frame):
    pipeline, ocr, vision, embedding, repository = parts
    sid = uuid4()
    result = pipeline.process_frame(frame, sid)
    assert result.status == "saved" and UUID(result.frame_id)
    assert ocr.extract_text.call_args.args[0] is frame.frame
    assert vision.analyze_image.call_args.args[0] is frame.frame
    args, kwargs = repository.save_frame.call_args
    assert args[0] == sid and args[1] == NOW and args[2] is frame.frame
    assert kwargs["ocr_text"] == "MOCK ROOM 205\nغرفة ٢٠٥"
    assert kwargs["objects"] == ["synthetic sign"]
    assert kwargs["caption"] == MockVision().analyze_image(None).caption
    assert kwargs["embedding_model"] == "text-embedding-3-small" and len(kwargs["embedding"]) == 1536
    assert kwargs["source_frame_index"] == 12 and kwargs["video_timestamp_ms"] == 1200.5
    assert "expires_at" not in kwargs and "created_at" not in kwargs
    assert result.vision_uncertain is True
    assert "confidence" not in vars(result) and "bounding_boxes" not in vars(result)
    embedding.embed_frame.assert_called_once_with(ocr_text=kwargs["ocr_text"], objects=kwargs["objects"], caption=kwargs["caption"])


def test_empty_successful_ocr_is_not_a_failure(parts, frame):
    parts[1].extract_text.return_value = OCRResult("", "mock", False, "")
    outcome = parts[0].process_frame(frame, uuid4())
    assert outcome.status == "saved" and outcome.stages["ocr"] == "success"
    assert parts[4].save_frame.call_args.kwargs["ocr_text"] == ""


def test_empty_metadata_no_embedding_or_zero_vector(parts, frame):
    parts[1].extract_text.return_value = OCRResult("", "mock", False, "")
    parts[2].analyze_image.return_value = VisionResult([], "", "mock", True)
    outcome = parts[0].process_frame(frame, uuid4())
    assert outcome.status == "saved" and outcome.stages["embedding"] == "skipped"
    parts[3].embed_frame.assert_not_called()
    kwargs = parts[4].save_frame.call_args.kwargs
    assert kwargs["embedding"] is None and kwargs["embedding_model"] is None


@pytest.mark.parametrize("stage", ["ocr", "vision", "embedding", "storage"])
def test_each_stage_failure_skips_storage_and_continues_other_frames(parts, video, stage):
    pipeline, ocr, vision, embedding, repo = parts
    methods = {"ocr": ocr.extract_text, "vision": vision.analyze_image, "embedding": embedding.embed_frame, "storage": repo.save_frame}
    method = methods[stage]
    good = {"ocr": MockOCR().extract_text(None), "vision": MockVision().analyze_image(None),
            "embedding": MockEmbedding().embed_frame("MOCK ROOM 205\nغرفة ٢٠٥", ["synthetic sign"], MockVision().analyze_image(None).caption),
            "storage": uuid4()}[stage]
    method.side_effect = [RuntimeError("secret-password-private-frame"), good]
    result = pipeline.process_video(video)
    assert result.failed_frames == 1 and result.saved_frames == 1 and result.fatal_error is None
    assert result.stage_counts[stage]["failures"] == 1
    assert result.outcomes[0].error_stage == stage
    assert "secret-password" not in json.dumps(result.to_dict())
    assert repo.save_frame.call_count == (2 if stage == "storage" else 1)


@pytest.mark.parametrize("error", [ImageStorageError("private"), RepositoryError("private")])
def test_ordinary_storage_failure_reported(parts, frame, error):
    parts[4].save_frame.side_effect = error
    result = parts[0].process_frame(frame, uuid4())
    assert result.error_stage == "storage" and not result.fatal


@pytest.mark.parametrize("error", [StorageConsistencyError("private"), DatabaseConnectionError("private")])
def test_fatal_infrastructure_stops_and_releases(parts, video, error):
    parts[4].save_frame.side_effect = error
    result = parts[0].process_video(video)
    assert result.sampled_frames == result.failed_frames == 1 and result.fatal_error == type(error).__name__


@pytest.mark.parametrize("bad", [None, [1.0] * 3, [0.0] * 1536, [float("nan")] * 1536, [float("inf")] * 1536, [True] * 1536])
def test_invalid_embedding_never_saved(parts, frame, bad):
    real = MockEmbedding().embed_frame("MOCK ROOM 205\nغرفة ٢٠٥", ["synthetic sign"], MockVision().analyze_image(None).caption)
    parts[3].embed_frame.return_value = replace(real, embedding=bad)
    outcome = parts[0].process_frame(frame, uuid4())
    assert outcome.error_stage == "embedding"
    parts[4].save_frame.assert_not_called()


@pytest.mark.parametrize("change", [{"model": "wrong"}, {"dimensions": 12}, {"source_text": "unrelated"}])
def test_wrong_embedding_contract_rejected(parts, frame, change):
    real = MockEmbedding().embed_frame("MOCK ROOM 205\nغرفة ٢٠٥", ["synthetic sign"], MockVision().analyze_image(None).caption)
    parts[3].embed_frame.return_value = replace(real, **change)
    assert parts[0].process_frame(frame, uuid4()).error_stage == "embedding"


def test_selector_used_once_and_reset_between_runs(parts, video):
    pipeline = parts[0]
    pipeline.selector = Mock(wraps=FrameSelector())
    first = pipeline.process_video(video)
    second = pipeline.process_video(video)
    assert pipeline.selector.evaluate.call_count == 8 and pipeline.selector.reset.call_count == 2
    assert first.selected_frames == second.selected_frames == 2
    assert set(first.frame_ids).isdisjoint(second.frame_ids)


def test_recording_time_normalized_to_utc(parts, video):
    start = NOW.astimezone(timezone(timedelta(hours=2)))
    result = parts[0].process_video(video, recording_start=start)
    assert result.capture_time_basis == "provided_recording_start"
    assert [call.args[1] for call in parts[4].save_frame.call_args_list] == [NOW, NOW + timedelta(seconds=3)]


def test_missing_recording_time_labelled_substitution(parts, video):
    result = parts[0].process_video(video)
    assert result.capture_time_basis == "run_start_plus_video_offset_substitute"


@pytest.mark.parametrize("start", [datetime(2026, 1, 1), "not-a-date"])
def test_naive_or_invalid_recording_time_rejected(parts, video, start):
    with pytest.raises(ValueError):
        parts[0].process_video(video, recording_start=start)


def test_dry_run_never_calls_repository(parts, video):
    result = parts[0].process_video(video, dry_run=True)
    assert result.analyzed_frames == 2 and result.saved_frames == 0 and result.frame_ids == []
    parts[4].save_frame.assert_not_called()


def test_cli_offline_no_database_no_images(video, capsys):
    with patch("database.connection.Database", side_effect=AssertionError("No DB construction")):
        assert main(["--video", str(video), "--offline-demo", "--dry-run", "--verbose"]) == 0
    body = json.loads(capsys.readouterr().out)
    assert body["mocked"] is True and body["dry_run"] is True and body["saved_frames"] == 0
    assert body["selected_frames"] == 2


def test_cli_requires_explicit_provider_choice(video):
    with pytest.raises(SystemExit) as error:
        main(["--video", str(video)])
    assert error.value.code == 2


def test_cli_invalid_config_stops_before_services(video):
    assert main(["--video", str(video), "--offline-demo", "--max-frames", "0"]) == 1


def test_import_has_no_io_requests():
    code = "from unittest.mock import patch\nwith patch('pymysql.connect', side_effect=AssertionError('DB')), patch('openai.OpenAI', side_effect=AssertionError('AI')):\n import processing.pipeline, database.retention\n"
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_env_configuration_precedence(monkeypatch):
    monkeypatch.setenv("PIPELINE_SAMPLE_INTERVAL_SECONDS", "2")
    monkeypatch.setenv("PIPELINE_MAX_TEST_FRAMES", "3")
    assert PipelineSettings.from_env() == PipelineSettings(2, 3)


def test_quota_failure_stops_without_repeated_provider_calls(parts, video):
    parts[1].extract_text.side_effect = OCRRateLimitError("quota")
    result = parts[0].process_video(video)
    assert result.sampled_frames == 1 and result.fatal_error == "OCRRateLimitError"
    parts[1].extract_text.assert_called_once()


def test_invalid_selected_image_does_not_corrupt_next_scene(parts, video):
    real_selector = FrameSelector()
    selector = Mock(wraps=real_selector)
    original = real_selector.evaluate
    # Explicit side effect function to preserve real selector state after the
    # first controlled image-validation error.
    calls = 0
    def evaluate(frame):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("bad image")
        return original(frame)
    selector.evaluate.side_effect = evaluate
    parts[0].selector = selector
    result = parts[0].process_video(video)
    assert result.selection_failures == 1 and result.saved_frames == 2
    assert result.sampled_frames == result.selected_frames + result.rejected_frames + result.selection_failures
