"""Actual JPEG decoding/redaction and /ask integration. Provider and database calls are isolated."""
import base64
import io
import json
import os
import secrets
import unittest
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
from app import assistant, depth, routes, vision_provider
from app.auth import ApiError, _connect, signed_in_user_id
from app.main import app

NOW = datetime.now(UTC)
TIMESTAMP_MS = NOW.timestamp() * 1000


def image_payload(size=(160, 240), format="JPEG"):
    image = Image.new("RGB", size, "teal")
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def snapshot(**changes):
    return depth.DepthSnapshot(**{"timestampMs": TIMESTAMP_MS, "centerM": 1.25, "jpeg": image_payload(), **changes})


def reply(matches=True, box=None):
    content = {"matches": matches, "box": [60, 80, 600, 700] if box is None else box}
    return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(content)}]}}]}


class SnapshotTests(unittest.TestCase):
    def test_bounded_strict_validation(self):
        for bad in [{"jpeg": "not/jpg!"}, {"jpeg": image_payload((481, 24))}, {"jpeg": image_payload(format="PNG")},
                    {"jpeg": "x" * (depth.MAX_BASE64_CHARS + 4)}, {"jpeg": image_payload()[:-8]},
                    {"centerM": 0}, {"centerM": 5.1}, {"centerM": "1.1"}, {"centerM": True},
                    {"centerM": float("nan")}, {"timestampMs": float("inf")}, {"timestampMs": -1},
                    {"timestampMs": 1e14}, {"unknown": True}]:
            with self.subTest(field=next(iter(bad))), self.assertRaises(ValidationError):
                snapshot(**bad)
        self.assertLess(len(repr(snapshot())), 160)

    def test_freshness_relative_to_arrival_with_clock_skew(self):
        value = snapshot()
        for delta in [-3, 0, 8]:
            self.assertTrue(value.fresh_at(NOW + timedelta(seconds=delta)))
        for delta in [-4, 9]:
            self.assertFalse(value.fresh_at(NOW + timedelta(seconds=delta)))

    def test_real_shared_privacy_pipeline_reencodes_without_original_metadata(self):
        original = Image.new("RGB", (160, 240), "teal")
        info = Image.Exif()
        info[315] = "private camera metadata"
        stream = io.BytesIO()
        original.save(stream, format="JPEG", exif=info)
        result = depth._private_jpeg(snapshot(jpeg=base64.b64encode(stream.getvalue()).decode()))
        self.assertNotIn(b"private camera metadata", result)
        self.assertNotEqual(result, stream.getvalue())
        with Image.open(io.BytesIO(result)) as image:
            self.assertEqual(image.size, original.size)
            self.assertFalse(image.getexif())

    def test_model_can_only_supply_a_strict_center_match(self):
        def generate(build, parse):
            request = build(False)
            self.assertNotIn("thinkingConfig", request["generationConfig"])
            self.assertNotIn("centerM", json.dumps(request))
            self.assertEqual(request["contents"][0]["parts"][1]["inline_data"]["data"], "Ymx1cnJlZA==")
            self.assertTrue(parse(reply()))
            for invalid in [None, {}, reply(matches="true"), reply(False), reply(box=[500, 0, 800, 850]),
                            reply(box=[100, 100, 499, 999]), reply(box=[-1, 0, 800, 850]),
                            reply(box=[True, 0, 800, 850]), reply(box=[]), {"candidates": [None]},
                            {"candidates": [{"finishReason": "MAX_TOKENS"}]}]:
                self.assertFalse(parse(invalid))
            return True
        with patch.object(vision_provider, "generate", side_effect=generate):
            self.assertTrue(depth._matches_target("How far is the door?", b"blurred"))

    def test_supported_languages_and_no_unverified_numbers(self):
        for language, question, expected in [("en", "How far is the chair?", "1.3 meters"),
                                             ("fr", "À quelle distance est la chaise ?", "1,3 mètre"),
                                             ("ar", "كم يبعد الكرسي؟", "١٫٣ متر"),
                                             ("ar", "قديش بعيد الباب؟", "١٫٣ متر")]:
            with patch.object(vision_provider, "configured", return_value=True), \
                 patch.object(depth, "_private_jpeg", return_value=b"blurred"), \
                 patch.object(depth, "_matches_target", return_value=True):
                result = assistant.answer(question, language, "s", Mock(), asked_at=NOW, depth=snapshot())
            self.assertIn(expected, result.text)
            self.assertFalse(result.uncertain)
            self.assertEqual(result.evidence_frame_ids, [])
            self.assertEqual(result.mode, "depth")
            for value in [None, snapshot(timestampMs=TIMESTAMP_MS-60_000)]:
                with patch.object(depth, "_private_jpeg") as privacy:
                    result = assistant.answer(question, language, "s", Mock(), asked_at=NOW, depth=value)
                self.assertTrue(result.uncertain)
                self.assertEqual(result.text, depth.RETRY[language])
                privacy.assert_not_called()

    def test_no_image_forwarding_without_eligibility_or_working_privacy(self):
        value = snapshot()
        for words in ["how far ahead", "measure distance", "what is the distance", "how far is it?",
                      "كم المسافة", "quelle est la distance", "How many meters away is that object?"]:
            self.assertFalse(depth.wants_named_distance(words))
        for words in ["How far is the door?", "what is the distance to the chair", "how many metres away is the door",
                      "كم يبعد الباب", "قديش بعيد الباب", "شو المسافة بيني وبين الباب", "à quelle distance est la porte",
                      "la porte est à combien de mètres"]:
            self.assertTrue(depth.wants_named_distance(words))
        with patch.object(vision_provider, "configured", return_value=False), \
             patch.object(depth, "_private_jpeg") as privacy:
            self.assertTrue(depth.answer("How far is the door?", "en", value, NOW)[1])
            privacy.assert_not_called()
        with patch.object(vision_provider, "configured", return_value=True), \
             patch.object(depth, "_private_jpeg", side_effect=RuntimeError("failed")) as privacy, \
             patch.object(depth, "_matches_target") as provider:
            self.assertTrue(depth.answer("What color is it?", "en", value, NOW)[1])
            privacy.assert_not_called()
            self.assertTrue(depth.answer("How far is the door?", "en", value, NOW)[1])
            privacy.assert_called_once()
            provider.assert_not_called()
        for effect in [lambda *args: False, vision_provider.VisionUnavailable("quota")]:
            with patch.object(vision_provider, "configured", return_value=True), \
                 patch.object(depth, "_private_jpeg", return_value=b"blurred"), \
                 patch.object(depth, "_matches_target", side_effect=effect):
                self.assertEqual(depth.answer("How far is the door?", "en", value, NOW), (depth.RETRY["en"], True))


class AskDepthTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[signed_in_user_id] = lambda: "account"
        app.dependency_overrides[routes.memory_client] = lambda: Mock()
        self.request = {"session_id": str(uuid.uuid4()), "question_id": str(uuid.uuid4()), "language": "en",
                        "question": "How far is the door?",
                        "depth": snapshot(timestampMs=datetime.now(UTC).timestamp() * 1000).model_dump()}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()

    def test_validation_and_body_limit_do_not_echo_images(self):
        for body, status in [({**self.request, "depth": {**self.request["depth"], "jpeg": "bad!"}}, 422),
                             ({**self.request, "junk": "x" * depth.MAX_ASK_BYTES}, 413)]:
            response = self.client.post("/api/v1/ask", json=body)
            self.assertEqual(response.status_code, status)
            self.assertLess(len(response.text), 180)
            self.assertNotIn("bad!", response.text)

    def test_retry_reads_saved_answer_and_storage_never_receives_image(self):
        saved = {"answer": "Saved distance", "language": "en", "uncertain": False, "evidence_frame_ids": []}
        with patch.object(routes, "get_question", side_effect=[None, saved, saved]), \
             patch.object(routes, "_check_session_owner") as owner, \
             patch.object(routes, "record_question") as store, \
             patch.object(vision_provider, "configured", return_value=True), \
             patch.object(depth, "_matches_target", return_value=True) as match:
            for _ in range(2):
                response = self.client.post("/api/v1/ask", json=self.request)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["answer"], saved["answer"])
        owner.assert_called_once()
        store.assert_called_once()
        match.assert_called_once()
        self.assertIn("1.3 meters", store.call_args.args[4])
        self.assertNotIn(self.request["depth"]["jpeg"], str(store.call_args))
        self.assertEqual(store.call_args.args[7], [])

    def test_other_account_cannot_invoke_image_provider(self):
        with patch.object(routes, "get_question", return_value=None), \
             patch.object(routes, "_check_session_owner", side_effect=ApiError(403, "session_not_yours", "Denied")), \
             patch.object(depth, "_matches_target") as provider:
            response = self.client.post("/api/v1/ask", json=self.request)
        self.assertEqual(response.status_code, 403)
        provider.assert_not_called()


@unittest.skipUnless(os.getenv("AETHER_MYSQL_INTEGRATION") == "1", "requires live MySQL opt-in")
class MySQLDepthTests(unittest.TestCase):
    def test_signed_in_measurement_history_and_idempotent_retry(self):
        email = f"depth-test-{uuid.uuid4()}@example.invalid"
        question = {"session_id": str(uuid.uuid4()), "question_id": str(uuid.uuid4()), "language": "en",
                    "question": "How far is the door?"}
        client = TestClient(app, base_url="https://testserver")
        user = None
        try:
            signup = client.post("/api/v1/auth/signup", json={"name": "Depth test", "email": email,
                                                             "password": secrets.token_urlsafe(32)})
            self.assertEqual(signup.status_code, 201)
            user = signup.json()["user"]["user_id"]
            with patch.object(vision_provider, "configured", return_value=True), \
                 patch.object(depth, "_matches_target", return_value=True) as match:
                question["depth"] = snapshot(timestampMs=datetime.now(UTC).timestamp() * 1000).model_dump()
                first = client.post("/api/v1/ask", json=question)
                self.assertEqual(first.status_code, 200, first.text)
                self.assertIn("1.3 meters", first.json()["answer"])
                question["depth"]["centerM"] = 4.4
                retry = client.post("/api/v1/ask", json=question)
                self.assertEqual(retry.json(), first.json())
                match.assert_called_once()
            history = client.get("/api/v1/questions").json()["questions"]
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["question_id"], question["question_id"])
            self.assertEqual(history[0]["answer"], first.json()["answer"])
            self.assertEqual(history[0]["evidence_frame_ids"], [])
            self.assertNotIn("jpeg", str(history))
        finally:
            client.close()
            if user:
                with closing(_connect()) as conn, conn.cursor() as cur:
                    cur.execute("DELETE FROM users WHERE user_id = %s AND email = %s", (user, email))
