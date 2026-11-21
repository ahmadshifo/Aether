""""What's in front of me?" also says how far the centre object is, in centimeters or meters (no network).

Run from web/ai-backend:  .venv\\Scripts\\python -m unittest discover tests
"""

import base64
import io
import json
import os
import unittest
from datetime import UTC, datetime
from unittest import mock

from PIL import Image

from app import assistant, depth, vision_provider

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)


def snapshot(center_m=1.5, age_ms=500):
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 90, 60)).save(buffer, "JPEG")
    return depth.DepthSnapshot(timestampMs=NOW.timestamp() * 1000 - age_ms, centerM=center_m,
                               jpeg=base64.b64encode(buffer.getvalue()).decode())


class Memory:
    def search(self, session_id, question, mode, limit):
        return [{"frame_id": "f-1", "captured_at": NOW.isoformat()}]

    def image(self, frame_id):
        return b"frame-jpeg"

    def live_state(self, session_id):
        return {}


def reply(text):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"answer": text, "uncertain": False})}]}}]}


class SceneDistanceTests(unittest.TestCase):
    def test_distances_are_said_in_centimeters_or_meters(self):
        for meters, language, words in [(0.84, "en", "80 centimeters"), (0.2, "en", "20 centimeters"),
                                        (0.96, "en", "1 meter"), (1.54, "en", "1.5 meters"), (3.0, "en", "3 meters"),
                                        (0.5, "fr", "50 centimètres"), (1.3, "fr", "1,3 mètre"),
                                        (2.4, "fr", "2,4 mètres"), (0.7, "ar", "٧٠ سنتيمتر"), (1.3, "ar", "١٫٣ متر")]:
            self.assertEqual(depth.spoken_distance(meters, language), words, (meters, language))

    def test_scene_questions_are_recognized_but_distance_and_reading_questions_are_not(self):
        for question in ["What's in front of me?", "what is ahead", "What do you see?", "Describe this",
                         "شو قدامي؟", "شو في قدامي", "ماذا أمامي؟", "Qu'est-ce qu'il y a devant moi ?", "Décris"]:
            self.assertTrue(depth.asks_scene(question), question)
        for question in ["How far is the door?", "Read the sign", "What color is my shirt?", "كم يبعد الباب؟"]:
            self.assertFalse(depth.asks_scene(question), question)

    def test_the_measured_picture_and_its_distance_go_to_the_ai(self):
        sent = []

        def post(model, key, body, timeout):
            sent.append(body)
            return reply("There is a closed door straight ahead, about 1.5 meters away.")

        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-key", "AI_PROVIDER": "gemini"}), \
                mock.patch.object(vision_provider, "_post", post), \
                mock.patch.object(depth, "_private_jpeg", return_value=b"blurred"):
            result = assistant.answer("What's in front of me?", "en", "s-1", Memory(), asked_at=NOW, wait=0,
                                      depth=snapshot(1.54))
        self.assertEqual(result.text, "There is a closed door straight ahead, about 1.5 meters away.")
        self.assertEqual((result.mode, result.evidence_frame_ids), ("latest", ["f-1"]))
        parts = sent[0]["contents"][0]["parts"]
        self.assertIn("measured about 1.5 meters", parts[1]["text"])
        self.assertEqual(base64.b64decode(parts[2]["inline_data"]["data"]), b"blurred")  # only the blurred copy

    def test_without_a_fresh_snapshot_it_is_asked_as_before(self):
        for value, question in [(None, "What's in front of me?"), (snapshot(age_ms=60_000), "What's in front of me?"),
                                (snapshot(), "Read the sign")]:
            sent = []
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-key", "AI_PROVIDER": "gemini"}), \
                    mock.patch.object(vision_provider, "_post", lambda m, k, body, t: sent.append(body) or reply("ok")), \
                    mock.patch.object(depth, "_private_jpeg", side_effect=AssertionError("no upload")):
                assistant.answer(question, "en", "s-1", Memory(), asked_at=NOW, wait=0, depth=value)
            self.assertNotIn("Measured picture", json.dumps(sent[0]["contents"]), question)

    def test_a_failed_face_blur_never_sends_the_original(self):
        with mock.patch.object(depth, "_private_jpeg", side_effect=RuntimeError("blur failed")):
            self.assertIsNone(depth.measured_picture("What's in front of me?", "en", snapshot(), NOW))


if __name__ == "__main__":
    unittest.main()
