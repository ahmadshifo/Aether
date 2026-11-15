<!-- All members: tracks approved interface changes so an individual teammate never silently breaks compatibility. -->
# Architecture Decision Log

## v1.0 - 2026-10-27

- Three independent owners: Mobile (1), Web and AI (2), Multimedia (3).
- Communication uses documented REST JSON contracts and MediaMTX stream paths.
- Public language codes are `en` and `ar`.
- Provider keys remain server-side, models are pretrained, and no model training is required.
- Working integrations must preserve UUIDs, UTC time and the specified response fields.

## Future changes

Record the date, owner, affected services, reason, and approved new contract version here before changing shared interfaces.

## 2026-11-07 - Multimedia frame storage (Member 3 area, proposed by Member 2)

- Database: MySQL Community 8.4 (SQLAlchemy/PyMySQL, embeddings as JSON) replaces the
  v1.0 PostgreSQL/pgvector plan for the multimedia service.
- Frame JPEGs: new optional RustFS (S3-compatible) object storage, selected with
  `FRAME_STORAGE_BACKEND=s3`; local disk (`stored_frames/`) stays the default.
- No schema change: `frames.image_path` stays `<session_id>/<frame_id>.jpg` and is the
  object key. Bucket `aether-frames` is private; APIs must still serve images through
  authorized endpoints, never raw storage paths.
- Affected services: multimedia (:8003) only. Public REST contracts are unchanged.
- Needs ahmadshifo (Member 3) approval before the S3 backend becomes the team default.

## 2026-11-08 - Save only answer frames; blur faces (Member 3 area, proposed by Member 2)

- Live frames stay in the multimedia server's RAM for 2 minutes and are not analyzed or stored.
- New endpoint `POST /api/v1/frames/keep` `{session_id, frame_ids}` -> 202 `{accepted, missing}`:
  Member 2 calls it with the answer's `evidence_frame_ids`; only those frames are analyzed
  (OCR, caption, embedding) and saved to MySQL/RustFS.
- `latest`/`recent` search return live (unanalyzed, empty caption/ocr_text/objects) frames;
  `history` returns saved answer frames. Response fields are unchanged.
- Faces are blurred with OpenCV YuNet (detection only) before frames are kept, sent to AI or saved.
- Affected: multimedia (:8003), Member 2's ai-backend (must call /frames/keep). Needs ahmadshifo's approval.

## 2026-11-08 - Question history endpoint (Member 2)

- `GET /api/v1/questions` is live in the AI backend (MySQL table `questions`, 24 h).
  `session_id` is optional (without it: the signed-in account's whole history).
- Each record adds `session_id`, `uncertain`, `evidence_frame_ids` and `demo` to `QuestionRecord`;
  the response adds `"demo": true|false`. Until real answers exist, the account gets demo records.
- Dashboard AI history and the phone's History screen read this endpoint.
- Also: `DELETE /api/v1/questions` (optional `session_id`) -> `{deleted}`, and `GET /api/v1/status`
  checks MediaMTX, multimedia `/health` and the OpenAI key live (`session_id` optional; adds
  `details` and `live_session`). Overview, System status, Live camera and Profile use them.

## 2026-11-08 - /api/v1/ask without a vision model yet (Member 2)

- `POST /api/v1/ask` follows the contract. It picks latest/recent/history from the question words
  (EN/AR), falls back to the last 2 minutes, saves question + answer + evidence to history, then calls
  multimedia `POST /api/v1/frames/keep` so the evidence images are stored.
- Until the OpenAI vision step is added, the answer is an honest placeholder ("I saved what your camera
  saw, but I can't describe it yet") with `uncertain: true`. Same `question_id` again returns the saved
  answer. A session owned by another account is refused (403).
- Member 1: the phone still makes its own demo answer; it must call `/api/v1/ask` instead.

## 2026-11-08 - Merged multimedia (Member 3's API as the base) with Member 2's additions

- Kept from Member 3: search/frames/image API with login + session ownership, Task 13 pipeline,
  Task 14 live runner, 24-hour retention worker, tests and docs.
- Added: automatic start per phone stream, YuNet face blur, 2-minute RAM memory merged into
  latest/recent search, one saved frame every LIVE_SAVE_EVERY_SECONDS plus answer frames via
  POST /api/v1/frames/keep, optional RustFS storage, "no-AI" services when keys are missing.
- AI backend `/ask` forwards the user's login cookie to the multimedia API. npm start runs api.main:app.

## 2026-11-13 - Live camera alerts on the dashboard (Member 2)

- New multimedia endpoint `GET /api/v1/live/state?session_id=` (login + session ownership, read-only):
  `{session_id, live_memory, last_frame_at, dark_since, frozen_since}` from the 2-minute RAM memory.
  Nothing is stored; no frame bytes are returned.
- New AI backend endpoint `GET /api/v1/alerts`: the signed-in account's live problems, worked out per
  request: camera dark or frozen for 10 s, no pictures arriving, video not reaching MediaMTX, memory
  service down. Nothing while the user said "camera off". SOS alerts stay on `GET /api/v1/sos`.
- The dashboard shows them as an amber banner on every page and a list on System status.
- Affected: multimedia (:8003, one read-only route), AI backend, dashboard. Needs ahmadshifo's approval.
