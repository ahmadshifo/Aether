<!-- Project entry point: explains the agreed architecture, ownership, and workflow for all three teammates. -->
# Multimedia Project - AI Visual Assistant

This is the **initial project structure**, not the completed application. Each source file explains its intended responsibility so the three teammates can begin implementation independently.

## Ownership

| Teammate | Folder | Responsibility |
| --- | --- | --- |
| 1 | `mobile/` | Mobile frontend, camera streaming, speech recognition, speech synthesis |
| 2 | `web/` | Web dashboard, AI answers, question history |
| 3 | `multimedia/` | Frame processing, OCR, objects, database, semantic search |

## Shared architecture v1.0

- APIs use `/api/v1`, JSON `snake_case`, UTF-8, UUID identifiers and UTC ISO 8601 timestamps.
- The phone publishes video to MediaMTX by WebRTC. The multimedia service consumes RTSP; the dashboard reads WebRTC.
- The mobile voice service accepts audio and returns text or synthesized MP3.
- The AI backend accepts recognized question text and returns a grounded textual answer.
- The multimedia API returns frames, OCR, captions, objects and semantic-search matches.
- Provider API keys stay on server-side services only. Do not commit `.env` files.
- No face recognition, no claims that an environment is safe, and delete old data.

Consult `docs/architecture.md`, `shared/contracts/` and `docs/integration-checklist.md` before implementing anything.

## First step

Each teammate implements and tests only their own folder using mock responses from `shared/fixtures/`. Service implementations can be added without modifying the agreed endpoints.
