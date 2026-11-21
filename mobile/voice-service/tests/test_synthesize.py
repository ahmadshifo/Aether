"""The voice service reads an answer aloud through Azure Speech (no network: Azure is faked).

Run from mobile/voice-service:  .venv\Scripts\python -m unittest discover tests
"""

import io
import os
import unittest
import urllib.error
from unittest import mock

from app import routes, speech_provider
from app.schemas import SynthesizeRequest

AZURE = {"AZURE_SPEECH_KEY": "test-key", "AZURE_SPEECH_REGION": "westeurope"}


class SynthesizeTests(unittest.TestCase):
    def test_reads_the_text_in_the_language_voice_and_returns_mp3(self):
        sent = []
        with mock.patch.dict(os.environ, AZURE), \
                mock.patch.object(speech_provider, "_post", lambda url, key, body: sent.append((url, key, body)) or b"ID3mp3"):
            response = routes.synthesize(SynthesizeRequest(text="أمامك باب مغلق <قريب> & كرسي", language="ar"))
        self.assertEqual((response.status_code, response.media_type, response.body), (200, "audio/mpeg", b"ID3mp3"))
        url, key, body = sent[0]
        self.assertEqual(url, "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1")
        self.assertEqual(key, "test-key")
        self.assertIn("ar-LB-LaylaNeural", body.decode())
        self.assertIn("&lt;قريب&gt; &amp; كرسي", body.decode())  # the text can't break the SSML

    def test_without_azure_settings_it_says_so(self):
        with mock.patch.dict(os.environ, {"AZURE_SPEECH_KEY": "", "AZURE_SPEECH_REGION": ""}), \
                mock.patch.object(speech_provider, "ENV_FILE", speech_provider.ENV_FILE.with_name("missing.env")):
            response = routes.synthesize(SynthesizeRequest(text="Hello", language="en"))
        self.assertEqual(response.status_code, 503)
        self.assertIn(b"voice_not_configured", response.body)

    def test_an_azure_error_is_a_502_without_the_key(self):
        error = urllib.error.HTTPError("url", 401, "unauthorized", {}, io.BytesIO(b"bad key test-key"))
        with mock.patch.dict(os.environ, AZURE), mock.patch.object(speech_provider, "_post", side_effect=error):
            response = routes.synthesize(SynthesizeRequest(text="Hello", language="fr"))
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(b"test-key", response.body)

    def test_requests_are_validated(self):
        for bad in [{"text": "", "language": "en"}, {"text": "hi", "language": "de"}, {"text": "x" * 2001}]:
            with self.assertRaises(ValueError):
                SynthesizeRequest(**bad)


if __name__ == "__main__":
    unittest.main()
