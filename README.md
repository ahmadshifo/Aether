<!-- Project entry point: explains the agreed architecture, ownership, and workflow for all three teammates. -->
# Multimedia Project - AI Visual Assistant

Aether includes an Expo/React Native phone app, React dashboard, FastAPI services,
MySQL history and RustFS frame storage. See [the complete Windows setup guide](docs/SETUP.md).

## Start locally

Install Docker Desktop (WSL2), Node LTS and Python 3.13, then follow the dependency
steps in the guide. From this repository:

```powershell
node scripts/configure-local.mjs
docker compose up -d --build
npm.cmd start
```

The first start downloads local Supertonic 3 TTS and multilingual faster-whisper
small/int8 and PaddleOCR English/Arabic/French weights. Later speech and OCR
inference need no API key. A new phone
development build includes memory-only microphone/WAV support; old binaries
show a device-voice fallback notice. Gemini vision stays unchanged.

This branch replaces typed caregiver notes with **Talk to user** live audio.
Use the same Aether account on the dashboard and phone, start a phone session,
then allow the dashboard microphone on localhost or HTTPS. A new native build is
required for speaker routing. Calls need a reachable LAN; no TURN relay is configured.
The setup guide covers installation, both phone platforms, tests and troubleshooting.
See [the OCR and live voice test report](docs/OCR-AND-LIVE-VOICE-VALIDATION.md)
for measured results, build links and the remaining physical-phone checks.

Do not delete old native database/storage files. The setup guide provides a
manual, non-destructive migration procedure and exact fallback locations.
Review `multimedia/` changes with ahmadshifo and `mobile/` changes with Hassan.

## Ownership

| Teammate | Folder | Responsibility |
| --- | --- | --- |
| 1 | `mobile/` | Native phone app (`mobile/native`), camera streaming, speech recognition, speech synthesis |
| 2 | `web/` | Web dashboard, AI answers, question history |
| 3 | `multimedia/` | Frame processing, OCR, objects, database, semantic search |

## Shared architecture v1.0

- APIs use `/api/v1`, JSON `snake_case`, UTF-8, UUID identifiers and UTC ISO 8601 timestamps.
- The phone publishes video to MediaMTX by WebRTC. The multimedia service consumes RTSP; the dashboard reads WebRTC.
- The local voice service accepts audio and returns UTF-8 text or PCM WAV, in memory only.
- The AI backend accepts recognized question text and returns a grounded textual answer.
- The multimedia API returns frames, OCR, captions, objects and semantic-search matches.
- Provider API keys stay on server-side services only. Do not commit `.env` files.
- No face recognition, no claims that an environment is safe, and delete old data.

Consult `docs/architecture.md`, `shared/contracts/` and `docs/integration-checklist.md` before implementing anything.

## First step

Each teammate implements and tests only their own folder using mock responses from `shared/fixtures/`. Service implementations can be added without modifying the agreed endpoints.
