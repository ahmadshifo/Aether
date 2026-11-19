"""Ask my history: questions about the past are answered from the user's last 24 hours (no network, no database).

Run from web/ai-backend:  .venv\\Scripts\\python -m unittest discover tests
"""

import io
import json
import os
import unittest
import urllib.error
from datetime import UTC, datetime
from unittest import mock

from app import assistant, history_answer, vision_provider

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
QUESTIONS = [{"asked_at": datetime(2026, 11, 19, 11, 40), "question": "What is on the table?",
              "answer": "A red mug and your keys on the right.", "location_label": "Hamra, Beirut"}]
FRAMES = {
    "s-1": [{"frame_id": "f-new", "captured_at": "2026-11-19T11:50:00Z", "caption": "A kitchen table with a red mug.",
             "objects": ["mug", "keys"], "ocr_text": ""},
            {"frame_id": "f-blank", "captured_at": "2026-11-19T11:49:00Z", "caption": "", "objects": [], "ocr_text": ""}],
    "s-2": [{"frame_id": "f-old", "captured_at": "2026-11-19T09:00:00Z", "caption": "A door with a sign.",
             "objects": ["door"], "ocr_text": "Room 204"}],
}


class Memory:
    def __init__(self, frames=FRAMES):
        self.frames, self.calls = frames, []

    def timeline(self, session_id, limit=60):
        self.calls.append(session_id)
        return list(self.frames.get(session_id, []))


def reply(answer: str, frames: list[str], uncertain: bool = False) -> dict:
    text = json.dumps({"answer": answer, "uncertain": uncertain, "frames": frames})
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


class HistoryAnswerTests(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-key", "AI_PROVIDER": "gemini"}),
                   mock.patch.object(history_answer, "past_questions", return_value=QUESTIONS),
                   mock.patch.object(history_answer, "recent_sessions", return_value=["s-1", "s-2"])]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_questions_about_the_past_are_history(self):
        for question in ["What did I ask earlier?", "Where did I see my keys?", "what did you tell me about the door",
                         "what did I see yesterday", "شو سألت اليوم", "وين حطيت المفتاح",
                         "Qu'est-ce que j'ai demandé tout à l'heure ?", "Où ai-je vu mes clés ?"]:
            self.assertEqual(assistant.choose_mode(question), "history", question)
        for question, mode in [("What's in front of me?", "latest"), ("what did I just pass", "recent")]:
            self.assertEqual(assistant.choose_mode(question), mode, question)

    def test_the_log_has_questions_and_useful_frames_with_how_long_ago(self):
        frames = history_answer.saved_frames(Memory(), ["s-1", "s-2"])
        self.assertEqual([f["frame_id"] for f in frames], ["f-new", "f-old"])  # the empty frame says nothing
        text, refs = history_answer.build_log(QUESTIONS, frames, NOW)
        self.assertEqual(refs, {"F1": "f-new", "F2": "f-old"})
        self.assertIn('Q, about 20 minutes ago in Hamra, Beirut: they asked "What is on the table?"', text)
        self.assertIn("F1, about 10 minutes ago: saw A kitchen table with a red mug. Objects: mug, keys.", text)
        self.assertIn('F2, about 3 hours ago: saw A door with a sign. Objects: door. Text read: "Room 204".', text)

    def test_answers_from_the_log_and_uses_the_frames_it_names_as_evidence(self):
        sent = []

        def post(model, key, body, timeout):
            sent.append(body)
            return reply("You saw your keys on the kitchen table about 10 minutes ago.", ["F1", "f9", "F1"])

        with mock.patch.object(vision_provider, "_post", post):
            result = history_answer.answer("Where did I see my keys?", "en", "user-1", Memory(), now=NOW)
        self.assertEqual(result.text, "You saw your keys on the kitchen table about 10 minutes ago.")
        self.assertEqual((result.uncertain, result.evidence_frame_ids, result.mode), (False, ["f-new"], "history"))
        prompt = sent[0]["contents"][0]["parts"][0]["text"]
        self.assertTrue(prompt.startswith("Question: Where did I see my keys?"))
        self.assertIn("Room 204", prompt)
        self.assertNotIn("inline_data", json.dumps(sent[0]))  # text only: no pictures are sent

    def test_nothing_saved_is_said_without_asking_the_ai(self):
        with mock.patch.object(history_answer, "past_questions", return_value=[]), \
                mock.patch.object(history_answer, "recent_sessions", return_value=[]), \
                mock.patch.object(vision_provider, "_post", side_effect=AssertionError("no AI call")):
            result = history_answer.answer("What did I ask earlier?", "en", "user-1", Memory(), now=NOW)
        self.assertEqual((result.text, result.uncertain), (history_answer.ANSWERS["en"]["empty"], True))

    def test_without_a_gemini_key_it_says_so(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            result = history_answer.answer("What did I ask earlier?", "fr", "user-1", Memory(), now=NOW)
        self.assertEqual(result.text, history_answer.ANSWERS["fr"]["no_ai"])

    def test_quota_is_said_honestly(self):
        error = urllib.error.HTTPError("url", 429, "quota", {}, io.BytesIO(b"quota"))
        with mock.patch.object(vision_provider, "_post", side_effect=error):
            result = history_answer.answer("What did I ask earlier?", "en", "user-1", Memory(), now=NOW)
        self.assertEqual((result.text, result.uncertain), (assistant.ANSWERS["en"]["quota"], True))

    def test_assistant_sends_history_questions_here_only_for_a_signed_in_user(self):
        with mock.patch.object(history_answer, "answer", return_value="from history") as called:
            self.assertEqual(assistant.answer("What did I ask earlier?", "en", "s-1", Memory(), user_id="user-1"),
                             "from history")
            called.assert_called_once()
        with mock.patch.object(history_answer, "answer", side_effect=AssertionError("not for camera questions")), \
                mock.patch.object(assistant, "find_evidence", return_value=("latest", [])), \
                mock.patch.object(assistant, "camera_blocked", return_value=False):
            result = assistant.answer("What's in front of me?", "en", "s-1", Memory(), user_id="user-1", wait=0)
        self.assertEqual(result.text, assistant.ANSWERS["en"]["none"])


if __name__ == "__main__":
    unittest.main()
