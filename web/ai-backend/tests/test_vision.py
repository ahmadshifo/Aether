"""Answers from the vision AI: what is sent, how replies and errors become spoken answers (no network).

Run from web/ai-backend:  .venv\Scripts\python -m unittest discover tests
"""

import json
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app import assistant, vision_provider
from app.vision_provider import VisionUnavailable, build_request, parse_response

NOW = datetime(2026, 11, 14, 12, 0, 0, tzinfo=UTC)


def frame(seconds_ago: float, name: str) -> dict:
    return {"frame_id": name, "captured_at": (NOW - timedelta(seconds=seconds_ago)).isoformat().replace("+00:00", "Z")}


class FakeMemory:
    def __init__(self, missing=()):
        self.missing = set(missing)

    def image(self, frame_id):
        return None if frame_id in self.missing else f"jpeg-{frame_id}".encode()


def reply(answer, uncertain=False):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"answer": answer, "uncertain": uncertain})}]}}]}


class RequestTests(unittest.TestCase):
    def test_pictures_are_sent_with_when_they_were_taken_and_the_language(self):
        body = build_request("What does this say?", "ar", [(b"a", 0.5), (b"b", 130)])
        texts = [part["text"] for part in body["contents"][0]["parts"] if "text" in part]
        self.assertEqual(texts, ["Question: What does this say?", "Picture 1, taken just now:",
                                 "Picture 2, taken about 2 minutes ago:"])
        self.assertEqual(sum("inline_data" in part for part in body["contents"][0]["parts"]), 2)
        self.assertIn("Arabic", body["systemInstruction"]["parts"][0]["text"])
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")

    def test_reply_is_read_as_answer_and_uncertain(self):
        self.assertEqual(parse_response(reply("A red mug on your right.")), ("A red mug on your right.", False))

    def test_blocked_or_broken_replies_are_errors_not_answers(self):
        for body in ({"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}},
                     {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}, reply("  ")):
            with self.assertRaises(VisionUnavailable):
                parse_response(body)


@patch.object(vision_provider, "configured", lambda: True)
class DescribeTests(unittest.TestCase):
    def test_answer_comes_from_the_ai_with_the_frame_images(self):
        with patch.object(vision_provider, "ask", return_value=("A desk with a laptop.", False)) as ask:
            text, uncertain = assistant.describe("what's in front of me", "en", [frame(1, "a"), frame(4, "b")],
                                                 FakeMemory(), NOW)
        self.assertEqual((text, uncertain), ("A desk with a laptop.", False))
        self.assertEqual(ask.call_args.args[2], [(b"jpeg-a", 1.0), (b"jpeg-b", 4.0)])

    def test_walking_questions_always_end_with_the_cane_reminder(self):
        with patch.object(vision_provider, "ask", return_value=("There are two steps down ahead.", True)):
            text, _ = assistant.describe("Is the way clear?", "en", [frame(1, "a")], FakeMemory(), NOW)
        self.assertTrue(text.endswith(assistant.ANSWERS["en"]["cane"]))

    def test_daily_limit_and_errors_are_said_honestly(self):
        for reason, key in (("quota", "quota"), ("failed", "failed")):
            with patch.object(vision_provider, "ask", side_effect=VisionUnavailable(reason)):
                self.assertEqual(assistant.describe("what's this", "fr", [frame(1, "a")], FakeMemory(), NOW),
                                 (assistant.ANSWERS["fr"][key], True))

    def test_no_frames_or_gone_images_never_reach_the_ai(self):
        with patch.object(vision_provider, "ask") as ask:
            self.assertEqual(assistant.describe("what's this", "en", [], FakeMemory(), NOW)[0], assistant.ANSWERS["en"]["none"])
            self.assertEqual(assistant.describe("what's this", "en", [frame(1, "a")], FakeMemory(["a"]), NOW)[0],
                             assistant.ANSWERS["en"]["none"])
        ask.assert_not_called()

    def test_without_a_key_it_says_the_ai_is_not_connected(self):
        with patch.object(vision_provider, "configured", lambda: False):
            self.assertEqual(assistant.describe("what's this", "ar", [frame(1, "a")], FakeMemory(), NOW)[0],
                             assistant.ANSWERS["ar"]["frames"])


class BlockedCameraTests(unittest.TestCase):
    class Memory(FakeMemory):
        def __init__(self, dark_since):
            super().__init__()
            self.dark_since = dark_since

        def search(self, session_id, query, mode, limit):
            return [frame(1, "old")]

        def live_state(self, session_id):
            return {"dark_since": self.dark_since}

    @patch.object(vision_provider, "configured", lambda: True)
    def test_a_covered_lens_is_said_instead_of_describing_older_pictures(self):
        with patch.object(vision_provider, "ask") as ask:
            result = assistant.answer("what's in front of me", "en", "s", self.Memory("2026-11-14T12:00:00Z"), wait=0)
        self.assertEqual(result.text, vision_provider.BLOCKED["en"])
        self.assertTrue(result.uncertain)
        ask.assert_not_called()

    @patch.object(vision_provider, "configured", lambda: True)
    def test_a_clear_lens_is_described_as_usual(self):
        with patch.object(vision_provider, "ask", return_value=("A closed door straight ahead.", False)):
            result = assistant.answer("what's in front of me", "en", "s", self.Memory(None), wait=0)
        self.assertEqual(result.text, "A closed door straight ahead.")

    def test_the_ai_is_told_the_exact_blocked_sentence_and_to_give_states_and_sides(self):
        instructions = build_request("q", "en", [(b"a", 1)])["systemInstruction"]["parts"][0]["text"]
        self.assertIn("There is something blocking my view. Please remove it from the front of the camera.", instructions)
        self.assertIn("open, closed or half open", instructions)
        self.assertIn("tipped over", instructions)


if __name__ == "__main__":
    unittest.main()
