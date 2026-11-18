"""Gemini captions for saved frames: request shape, reading the reply, the rate limit and never losing a frame.
Offline: Gemini is replaced by a fake post function, no network or key needed."""

import io
import json
import urllib.error

import cv2
import numpy as np

from processing.gemini_vision import GeminiVisionService, build_request, to_jpeg
from processing.live_service import CombinedLivePipeline, NoAIEmbedding, NoAIOCR
from processing.pipeline import MultimediaPipeline
from processing.frame_memory import FrameMemory
from test_live_service import NOW, Clock, FakeRepository, feed, scene


def reply(objects, caption, uncertain=False):
    text = json.dumps({"objects": objects, "caption": caption, "uncertain": uncertain})
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def image():
    return np.full((1200, 1600, 3), 120, np.uint8)


def test_the_request_sends_one_small_jpeg_with_the_shared_instructions():
    body = build_request(to_jpeg(image()))
    jpeg = __import__("base64").b64decode(body["contents"][0]["parts"][1]["inline_data"]["data"])
    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert max(decoded.shape[:2]) == 1024
    assert "face recognition" in body["systemInstruction"]["parts"][0]["text"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_a_caption_and_labels_come_back_as_a_vision_result():
    service = GeminiVisionService("k", post=lambda body: reply([" Chair", "door", "chair"], "An open door. "),
                                  clock=FakeClock())
    result = service.analyze_image(image())
    assert result.objects == ["chair", "door"] and result.caption == "An open door."
    assert result.model == "gemini-3.1-flash-lite" and result.uncertain is False


def test_at_most_one_request_per_interval_so_answers_keep_their_quota():
    calls, clock = [], FakeClock()
    service = GeminiVisionService("k", min_seconds=60, post=lambda body: calls.append(1) or reply([], "A desk."),
                                  clock=clock)
    assert service.analyze_image(image()).caption == "A desk."
    clock.now = 30
    skipped = service.analyze_image(image())
    assert skipped.caption == "" and skipped.uncertain and len(calls) == 1
    clock.now = 61
    assert service.analyze_image(image()).caption == "A desk." and len(calls) == 2


def test_quota_or_network_errors_give_an_empty_caption_instead_of_an_error():
    def quota(body):
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, io.BytesIO(b"quota"))

    def offline(body):
        raise urllib.error.URLError("no network")

    for post in (quota, offline, lambda body: {"candidates": []}):
        result = GeminiVisionService("k", post=post, clock=FakeClock()).analyze_image(image())
        assert result.caption == "" and result.objects == [] and result.uncertain


def test_a_model_without_thinking_is_asked_again_without_it():
    sent = []

    def post(body):
        sent.append(body)
        if "thinkingConfig" in body["generationConfig"]:
            raise urllib.error.HTTPError("u", 400, "Bad", {}, io.BytesIO(b"thinking is not supported"))
        return reply(["cup"], "A cup.")

    assert GeminiVisionService("k", post=post, clock=FakeClock()).analyze_image(image()).caption == "A cup."
    assert len(sent) == 2


def test_a_captioned_frame_is_saved_without_a_search_vector():
    repository = FakeRepository()
    vision = GeminiVisionService("k", min_seconds=0, post=lambda body: reply(["door"], "An open door."),
                                 clock=FakeClock())
    inner = MultimediaPipeline(ocr_service=NoAIOCR(), vision_service=vision, embedding_service=NoAIEmbedding(),
                               repository=repository, mocked=False)
    clock = Clock()
    combined = CombinedLivePipeline(inner, FrameMemory(clock=lambda: NOW), None, 15, clock=clock)
    outcome = feed(combined, clock, scene(1), 0, 0)
    assert outcome.status == "saved" and outcome.stages["embedding"] == "skipped"
    saved = repository.saved[0]
    assert saved.caption == "An open door." and saved.objects == ["door"]
    assert saved.embedding is None and saved.embedding_model is None


def test_analysis_services_use_gemini_for_captions_without_an_openai_key(monkeypatch):
    from processing import live_service
    keys = {"GEMINI_API_KEY": "g", "OPENAI_API_KEY": "", "MISTRAL_API_KEY": ""}
    monkeypatch.setattr(live_service, "setting", lambda name, default: keys.get(name, default))
    ocr, vision, embedding, real = live_service.analysis_services()
    assert isinstance(vision, GeminiVisionService) and isinstance(embedding, NoAIEmbedding) and real
    keys["GEMINI_API_KEY"] = ""
    assert isinstance(live_service.analysis_services()[1], live_service.NoAIVision)


def test_reading_text_can_be_switched_off_while_keeping_the_mistral_key(monkeypatch):
    from processing import live_service
    keys = {"MISTRAL_API_KEY": "m", "MULTIMEDIA_OCR": "off"}
    monkeypatch.setattr(live_service, "setting", lambda name, default: keys.get(name, default))
    assert isinstance(live_service.analysis_services()[0], NoAIOCR)
