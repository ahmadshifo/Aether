"""Opt-in offline fixtures for Task 8; earlier test configuration is unchanged."""

import json
from unittest.mock import Mock

import cv2
import httpx
import numpy as np
import pytest
from openai.types.responses import Response


@pytest.fixture
def vision_offline(monkeypatch, tmp_path):
    from processing import object_detector
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_VISION_MODEL", raising=False)
    monkeypatch.setattr(object_detector, "ENV_FILE", tmp_path / "absent.env")

    def forbid_network(*args, **kwargs):
        raise AssertionError("Vision tests must never use a real HTTP transport")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid_network)


@pytest.fixture
def vision_image():
    image = np.full((128, 160, 3), 30, dtype=np.uint8)
    cv2.rectangle(image, (10, 10), (80, 110), (210, 210, 210), -1)
    cv2.putText(image, "A", (95, 80), cv2.FONT_HERSHEY_SIMPLEX,
                1.5, (130, 130, 130), 3)
    return image


@pytest.fixture
def vision_response():
    def create(payload=None, *, raw_text=None, status="completed", refusal=False, reasoning=False):
        if payload is None:
            payload = {"objects": ["chair", "table"],
                       "caption": "A chair is beside a table.", "uncertain": False}
        content = ([{"type": "refusal", "refusal": "private provider refusal"}] if refusal else
                   [{"type": "output_text", "text": raw_text if raw_text is not None else json.dumps(payload),
                     "annotations": []}])
        output = [{"id": "msg_offline", "type": "message", "role": "assistant",
                   "status": "completed", "content": content}]
        if reasoning:
            output.insert(0, {"id": "rs_offline", "type": "reasoning", "summary": []})
        return Response.model_validate({
            "id": "resp_offline", "object": "response", "created_at": 0,
            "model": "gpt-5.4-mini", "status": status, "error": None,
            "incomplete_details": {"reason": "max_output_tokens"} if status == "incomplete" else None,
            "output": output, "parallel_tool_calls": False, "tool_choice": "auto", "tools": [],
        })
    return create


@pytest.fixture
def vision_client(vision_response):
    client = Mock()
    client.with_options.return_value = client
    client.responses.create.return_value = vision_response()
    return client
