"""SOS number checks and the daily summary numbers (no database, no network).

Run from web/ai-backend:  .venv\\Scripts\\python -m unittest discover tests
"""

import unittest
from datetime import datetime, timedelta

from app.auth import ApiError
from app.safety import clean_phone_number
from app.summary import build_summary, camera_minutes, day_window, topic_of

NOW = datetime(2026, 11, 10, 14, 30)  # naive UTC, like the database: 16:30 in Lebanon (UTC+2)
LEBANON = -120  # JavaScript's getTimezoneOffset() for UTC+2


class PhoneNumberTests(unittest.TestCase):
    def test_spaces_dashes_and_brackets_are_removed(self):
        self.assertEqual(clean_phone_number("+961 3-123 456"), "+9613123456")
        self.assertEqual(clean_phone_number("(01) 234.567"), "01234567")

    def test_short_emergency_numbers_are_allowed(self):
        self.assertEqual(clean_phone_number("112"), "112")

    def test_empty_clears_the_number(self):
        self.assertIsNone(clean_phone_number("   "))
        self.assertIsNone(clean_phone_number(None))

    def test_letters_or_too_long_are_refused(self):
        for bad in ("call mom", "12", "+1234567890123456", "+961 3 abc"):
            with self.assertRaises(ApiError):
                clean_phone_number(bad)


class SummaryTests(unittest.TestCase):
    def test_today_starts_at_local_midnight(self):
        start, end = day_window(NOW, LEBANON)
        self.assertEqual(start, datetime(2026, 11, 9, 22, 0))  # 00:00 in Lebanon
        self.assertEqual(end - start, timedelta(days=1))

    def test_questions_are_grouped_by_topic(self):
        self.assertEqual(topic_of("What does this sign say?"), "reading")
        self.assertEqual(topic_of("Where are my keys"), "finding")
        self.assertEqual(topic_of("Is the way clear"), "safety")
        self.assertEqual(topic_of("what's in front of me"), "describing")
        self.assertEqual(topic_of("ماذا يوجد أمامي؟"), "describing")
        self.assertEqual(topic_of("can you sing"), "other")

    def test_camera_minutes_count_only_today_and_live_sessions_up_to_now(self):
        start, end = day_window(NOW, LEBANON)
        sessions = [
            {"started_at": start - timedelta(minutes=30), "ended_at": start + timedelta(minutes=10)},  # 10 min today
            {"started_at": NOW - timedelta(minutes=20), "ended_at": None},  # live: 20 min so far
        ]
        self.assertEqual(camera_minutes(sessions, start, end, NOW), 30)

    def test_build_summary(self):
        start, end = day_window(NOW, LEBANON)
        at = datetime(2026, 11, 10, 8, 5)  # 10:05 in Lebanon
        questions = [
            {"question": "Read the sign", "language": "en", "uncertain": False, "asked_at": at},
            {"question": "What does it say", "language": "en", "uncertain": True, "asked_at": at},
            {"question": "ماذا يوجد أمامي؟", "language": "ar", "uncertain": False, "asked_at": at + timedelta(hours=3)},
        ]
        sos = [{"acknowledged_at": None}, {"acknowledged_at": at}]
        result = build_summary(questions, [], sos, start, end, NOW, LEBANON)
        self.assertEqual(result["questions"], 3)
        self.assertEqual(result["unsure_answers"], 1)
        self.assertEqual(result["languages"], {"ar": 1, "en": 2})
        self.assertEqual(result["main_topic"], "reading")
        self.assertEqual(result["questions_per_hour"][10], 2)
        self.assertEqual(result["questions_per_hour"][13], 1)
        self.assertEqual(result["busiest_hour"], 10)
        self.assertEqual((result["sos_alerts"], result["sos_unanswered"]), (2, 1))

    def test_an_empty_day(self):
        start, end = day_window(NOW, LEBANON)
        result = build_summary([], [], [], start, end, NOW, LEBANON)
        self.assertEqual((result["questions"], result["main_topic"], result["busiest_hour"]), (0, None, None))


if __name__ == "__main__":
    unittest.main()
