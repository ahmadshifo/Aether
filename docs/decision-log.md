<!-- All members: tracks approved interface changes so an individual teammate never silently breaks compatibility. -->
# Architecture Decision Log

## 2026-11-27 - Proposed Docker storage and local multilingual voice

- Branch `feat/local-docker-voice`; no merge to main until owner/device review.
- MySQL 8.4 on loopback 3307 and official `rustfs/rustfs:1.0.7` on loopback 9000
  use named volumes. Private bucket initialization refuses existing bucket policies.
  Credentials stay in root .env; old native data is preserved and migration is manual.
- Replace cloud speech with pinned Supertonic 1.3.1 (Supertonic 3 weights) and
  faster-whisper 1.2.1, multilingual small/int8 CPU. The small model favors Arabic
  accuracy over tiny/base latency. Separate workers permit recognition during TTS.
- Add `/api/v1/voice/tts`, `/stt`, `/health`; use snake_case, en/ar/fr and standard
  errors. `/synthesize` stays as a deprecated dashboard alias, now MIME-correct WAV.
  The old `/transcribe` placeholder was never implemented; new clients use `/stt`.
- Audio stays in RAM on phone and server. Only model weights persist. Native
  AetherAudio requires fresh iOS/Android builds. Active sessions prefer local voice;
  missing/unreachable/busy services show device fallback. Wake and pre-login safety
  speech remain on-device. Existing command/haptic controller behavior is retained.
- Supertonic upstream is archived; code is MIT, weights OpenRAIL-M. Team review
  must assess the pinned dependency and license before distribution.
- Gemini vision is unchanged. `multimedia/` edits need ahmadshifo's approval and
  `mobile/` edits need Hassan's. Neither approval is implied by this branch.
- Sources: [RustFS Docker](https://docs.rustfs.com/en/installation/container/docker),
  [Supertonic Python](https://github.com/supertone-oss-archive/supertonic-py),
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

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

## 2026-11-15 - Card blur in saved frames (Member 2)

- `multimedia/processing/card_redact.py` blurs card-shaped rectangles (ISO ID-1, about 1.59 : 1: bank cards,
  ID cards, driving licences) in every frame before `save_frame` stores it, via a repository wrapper set up in
  `build_live`. Plain OpenCV edge and shape checks, no AI, no keys. Fail-safe like face blur: a frame whose
  redaction fails is not saved. `MULTIMEDIA_CARD_BLUR=off` turns it off.
- Live frames in RAM and the pictures sent to the answer AI are not card-blurred, so reading a sign still works.
- Not covered without OCR: ID numbers and addresses on letters or forms. Other card-shaped things (a screen seen
  straight on, a postcard) may be blurred too, in the saved copy only.
- Affected: multimedia (save path only, no API change). Needs ahmadshifo's approval.

## 2026-11-18 - Gemini captions for saved frames, OCR switch (Member 2)

- Without an OpenAI key, saved frames get their caption and object labels from Gemini
  (`multimedia/processing/gemini_vision.py`, same instructions and `VisionResult` as the OpenAI vision service,
  same free `GEMINI_API_KEY` as the AI backend). At most one request per `GEMINI_CAPTION_MIN_SECONDS` (default 60),
  because the free daily quota is shared with answers. A skipped or failed caption leaves it empty; the frame is
  still saved.
- Search vectors stay off: the `frames` table only accepts OpenAI's `text-embedding-3-small`. Frames without a
  vector are now saved instead of failing the pipeline. A free embedding model needs a schema change (Member 3).
- `MULTIMEDIA_OCR=off` turns text reading off while keeping the Mistral key (its free plan allows 0 OCR requests,
  and a failed OCR request stopped periodic frames from being saved). A free local OCR is planned.
- Affected: multimedia only, no API or database change. Needs ahmadshifo's approval.

## 2026-11-19 - Where am I, Ask my history (Member 2)

- "Where am I?" (also "which street is this", "وين أنا", "où suis-je") is a phone command, answered on the
  phone: a fresh GPS fix turned into street, place name and area (`mobile/native/src/platform/whereAmI.ts`,
  `placeAnswer` in `src/voice/basics.ts`). Nothing is saved or sent to Aether. It asks for location permission
  when needed and is separate from the "Save area in History" setting. Needs a new phone build (the location
  permission text changed). Affects Member 1's app: needs Hassan's approval.
- "Ask my history": a question about the past ("what did I ask earlier?", "where did I see my keys?",
  "شو سألت اليوم", "qu'est-ce que j'ai demandé tout à l'heure") is answered from the account's last 24 hours:
  its questions and answers plus the captions, objects and read text of saved frames (Member 3's existing
  `GET /api/v1/frames` timeline). Gemini gets this as text only and must answer only from it; the frames it
  names become the answer's evidence (`web/ai-backend/app/history_answer.py`). No API or database change.
