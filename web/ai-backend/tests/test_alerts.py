"""Live camera alerts: when each one shows and when it stays quiet (no database, no network).

Run from web/ai-backend:  .venv\Scripts\python -m unittest discover tests
"""

import unittest
from datetime import datetime, timedelta

from app.alerts import build_alerts

NOW = datetime(2026, 11, 13, 20, 0, 0)
SESSION = {"session_id": "11111111-1111-1111-1111-111111111111", "started_at": NOW - timedelta(minutes=5)}


def iso(seconds_ago):
    return (NOW - timedelta(seconds=seconds_ago)).isoformat() + "Z"


def state(last=1, dark=None, frozen=None):
    return {"last_frame_at": iso(last) if last is not None else None,
            "dark_since": iso(dark) if dark is not None else None,
            "frozen_since": iso(frozen) if frozen is not None else None}


def kinds(*args):
    return [alert["kind"] for alert in build_alerts(NOW, *args)]


class AlertTests(unittest.TestCase):
    def test_a_healthy_camera_has_no_alerts(self):
        self.assertEqual(kinds(SESSION, False, True, True, state()), [])

    def test_nothing_when_not_streaming_or_camera_paused_on_purpose(self):
        self.assertEqual(kinds(None, False, False, False, None), [])
        self.assertEqual(kinds(SESSION, True, False, False, state(dark=60)), [])

    def test_dark_only_after_ten_seconds(self):
        self.assertEqual(kinds(SESSION, False, True, True, state(dark=4)), [])
        self.assertEqual(kinds(SESSION, False, True, True, state(dark=12)), ["camera_dark"])

    def test_frozen_picture(self):
        self.assertEqual(kinds(SESSION, False, True, True, state(frozen=6)), [])
        self.assertEqual(kinds(SESSION, False, True, True, state(frozen=20)), ["camera_frozen"])

    def test_no_pictures_arriving(self):
        self.assertEqual(kinds(SESSION, False, True, True, state(last=40)), ["no_picture"])
        self.assertEqual(kinds(SESSION, False, True, True, state(last=None)), ["no_picture"])

    def test_a_new_session_gets_time_to_send_its_first_pictures(self):
        new = {**SESSION, "started_at": NOW - timedelta(seconds=5)}
        self.assertEqual(kinds(new, False, False, True, state(last=None)), [])

    def test_video_not_reaching_the_server_hides_the_follow_on_alerts(self):
        self.assertEqual(kinds(SESSION, False, False, True, state(last=40, dark=30)), ["phone_disconnected"])

    def test_memory_service_down(self):
        self.assertEqual(kinds(SESSION, False, True, False, None), ["memory_offline"])

    def test_a_new_problem_gets_a_new_id_so_seen_alerts_come_back(self):
        first = build_alerts(NOW, SESSION, False, True, True, state(dark=30))[0]["alert_id"]
        second = build_alerts(NOW, SESSION, False, True, True, state(dark=15))[0]["alert_id"]
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
