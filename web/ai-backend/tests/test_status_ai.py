"""The AI line on System status follows the Gemini key, which is what answers questions.

Run from web/ai-backend:  .venv\Scripts\python -m unittest discover tests
"""

import os
import unittest
from unittest import mock

from app import status


class AiStatusTest(unittest.TestCase):
    def test_online_with_gemini_key_and_no_openai_key(self):
        with mock.patch.dict(os.environ, {"AI_PROVIDER": "gemini", "GEMINI_API_KEY": "test-key"}, clear=True):
            self.assertEqual(status.check_ai()[0], "online")

    def test_offline_without_gemini_key(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "old-key"}, clear=True):
            state, detail = status.check_ai()
        self.assertEqual(state, "offline")
        self.assertIn("Gemini", detail)


if __name__ == "__main__":
    unittest.main()
