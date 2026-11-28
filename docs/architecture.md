# Aether architecture

## Ownership

- Mobile (Hassan): Expo/React Native, camera, MediaMTX, native memory-only audio,
  local Supertonic 3 TTS and faster-whisper STT.
- Web: React dashboard, vision-language answers, account and question history APIs.
- Multimedia (ahmadshifo): OpenCV frame pipeline, OCR, captioning, MySQL metadata,
  RustFS frame objects and search APIs.

Changes under `multimedia/` require ahmadshifo's approval; changes under `mobile/`
require Hassan's approval. This feature branch is proposed, not an assertion of approval.

## Data flow

Phone video -> MediaMTX WHIP -> multimedia RTSP ingestion -> live frames in RAM,
metadata in MySQL, and privacy-filtered saved images in private RustFS. The
existing live evidence pipeline remains unchanged. The AI backend retrieves evidence and uses the
existing Gemini vision integration. Its credentials and model choice are unchanged.

Phone PCM in memory -> authenticated AI backend :8002 -> voice gateway :8001 ->
faster-whisper -> question text -> existing answer API -> Supertonic 3 -> WAV in
phone memory. The dashboard uses the same authenticated voice proxy.

Root Compose runs MySQL 8.4 (:3307), RustFS (:9000, console :9001), a private-bucket
initializer, two CPU voice workers and PaddleOCR (:8004). Storage, OCR and voice ports bind to loopback.
The TTS gateway forwards STT to an internal worker. Separate workers allow speech
recognition while an answer is synthesized. Each worker accepts one inference at
a time; busy requests return 429 and the phone uses explicit device fallback.

Named volumes persist rows, frame objects and model weights across restarts.
Audio is not written by the app or services to files, caches or database tables.
Internet is needed to download weights initially; later voice inference is local.

The phone submits an utterance after silence, bounded to 15 seconds. It plays WAV
from memory. Foreground wake detection remains on-device. First-use safety text
before authentication also uses device speech so the warning works before setup.
Active sessions use local voice; unavailable models, missing native modules or
network failures produce a translated fallback notice and device voice. Stop,
repeat, speech-rate and vibration logic remain in the session controller.

## Contracts and deployment

Read-text questions select their frame and requested language, then send the image
to local PaddleOCR. EN uses en_PP-OCRv5_mobile_rec, FR uses latin_PP-OCRv5_mobile_rec,
and AR uses arabic_PP-OCRv5_mobile_rec, with a shared mobile detector. Low-confidence
results produce a translated move-closer response; no language model completes text.
Other scene questions retain Gemini. Background frame OCR uses OCR_DEFAULT_LANGUAGE.

Dashboard microphone -> direct DTLS-SRTP WebRTC -> native phone speaker. The backend
exchanges SDP/ICE over authenticated WebSocket tickets but never receives call audio.
The existing same-account ownership check links a dashboard to its active phone.
Only call metadata goes to MySQL. One backend worker is required because tickets
and active calls live in process memory. A restart ends calls; it cannot resume them.

Phone TTS pauses after the chime and caregiver announcement. End live voice and
end-call voice commands stop the connection; Stop session/background/logout also
close it. SOS ends the call before speaking. Camera controls still work. There is
no maximum call length, but disconnects require an explicit new Start. LAN host ICE
is the current deployment; cross-network calls need a separately configured TURN relay.

Use `shared/contracts/api-v1.yaml` for HTTP shapes and `media-v1.yaml` for stream
paths. UUID session IDs and UTC timestamps remain unchanged. Do not directly
access another member's internal storage in application code. See
[SETUP.md](SETUP.md) for dependencies, migration, ports, model licensing and tests.
