"""Evidence choice for /api/v1/ask, with a fake camera memory (no network, no database, no waiting).

Run from web/ai-backend:  .venv\\Scripts\\python -m unittest discover tests
"""

import unittest
from datetime import UTC, datetime, timedelta

from app import assistant

ASKED = datetime(2026, 11, 8, 15, 0, 0, tzinfo=UTC)


def frame(seconds: float, name: str) -> dict:
    stamp = (ASKED + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")
    return {"frame_id": name, "captured_at": stamp}


class FakeMemory:
    def __init__(self, frames):
        self.frames, self.calls = frames, []

    def search(self, session_id, query, mode, limit):
        self.calls.append((mode, limit))
        return list(self.frames)[:limit]


class EvidenceTests(unittest.TestCase):
    def test_in_front_waits_then_takes_one_view_after_and_one_before(self):
        memory = FakeMemory([frame(3, "after-3s"), frame(1, "after-1s"), frame(-1, "before-1s"), frame(-6, "before-6s")])
        waited = []
        mode, frames = assistant.find_evidence(memory, "s", "what's in front of me", ASKED, 3, waited.append)
        self.assertEqual(waited, [3])
        self.assertEqual(mode, "latest")
        self.assertEqual([f["frame_id"] for f in frames], ["after-3s", "before-1s"])
        self.assertEqual(memory.calls, [("latest", assistant.LATEST_POOL)])

    def test_only_frames_from_before_still_gives_two(self):
        memory = FakeMemory([frame(-1, "before-1s"), frame(-4, "before-4s"), frame(-8, "before-8s")])
        _, frames = assistant.find_evidence(memory, "s", "what is this", ASKED, 0)
        self.assertEqual([f["frame_id"] for f in frames], ["before-1s", "before-4s"])

    def test_only_frames_from_after_still_gives_two(self):
        memory = FakeMemory([frame(2, "after-2s"), frame(1, "after-1s")])
        _, frames = assistant.find_evidence(memory, "s", "read the sign", ASKED, 0)
        self.assertEqual([f["frame_id"] for f in frames], ["after-2s", "after-1s"])

    def test_questions_about_the_past_never_wait(self):
        memory = FakeMemory([frame(-30, "passed")])
        waited = []
        mode, _ = assistant.find_evidence(memory, "s", "what did I just pass", ASKED, 3, waited.append)
        self.assertEqual((mode, waited), ("recent", []))

    def test_keeps_checking_while_a_new_session_has_no_frames_yet(self):
        class Arriving(FakeMemory):
            def search(self, session_id, query, mode, limit):
                self.calls.append((mode, limit))
                return [frame(5, "first")] if len(self.calls) >= 3 else []

        memory, now = Arriving([]), [0.0]
        sleep = lambda seconds: now.__setitem__(0, now[0] + seconds)
        _, frames = assistant.find_evidence(memory, "s", "what's in front of me", ASKED, 0, sleep, 8, lambda: now[0])
        self.assertEqual([f["frame_id"] for f in frames], ["first"])
        self.assertEqual(now[0], 2.0)  # found on the third check, a second apart

    def test_gives_up_after_the_startup_wait(self):
        memory, now = FakeMemory([]), [0.0]
        sleep = lambda seconds: now.__setitem__(0, now[0] + seconds)
        mode, frames = assistant.find_evidence(memory, "s", "what's in front of me", ASKED, 0, sleep, 8, lambda: now[0])
        self.assertEqual((mode, frames), ("recent", []))
        self.assertEqual(now[0], 8.0)

    def test_answer_uses_the_configured_wait(self):
        memory = FakeMemory([frame(1, "after"), frame(-1, "before")])
        result = assistant.answer("what's in front of me", "en", "s", memory, asked_at=ASKED, wait=0)
        self.assertEqual(result.evidence_frame_ids, ["after", "before"])
        self.assertTrue(result.uncertain)
        self.assertEqual(assistant.AFTER_SECONDS, 3.0)


if __name__ == "__main__":
    unittest.main()
