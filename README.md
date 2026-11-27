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
small/int8 weights. Later voice inference needs no speech API key. A new phone
development build includes memory-only microphone/WAV support; old binaries
show a device-voice fallback notice. Gemini vision stays unchanged.

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
