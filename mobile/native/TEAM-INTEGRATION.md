# Mobile integration with the team backend

Verified 2026-11-07 against `main` commit `439ea412e895993a8a942ae40a5b221443a69e81`.
Work branch: `codex/mobile-team-integration`. Implementation changes are confined to `mobile/native`.

## What now works

- **Real MySQL-backed accounts:** the native app uses the shared backend's signup, login, current-user and logout routes. The retired development account server and canned-answer generator were removed. Old saved development connections become an editable team-server draft and require saving before authentication.
- **Profile editing:** Settings can update the display name through `PATCH /api/v1/auth/me`. Account ownership stays stable; cancelled or late requests cannot update a locked account.
- **Account-linked streaming:** the camera's session UUID is registered with the shared backend. The web dashboard can discover that same account's session through `/api/v1/streams/active`. Start/Stop requests are ordered; unauthorized responses lock the mobile account.
- **Answer API client:** recognized text is sent to `POST /api/v1/ask` using the canonical request. A valid response is spoken with the existing device TTS and saved locally with its uncertainty/evidence IDs. Stop, background, language changes and logout cancel pending work. Missing APIs produce an explicit error, never a fabricated answer.
- **Connection diagnostics:** the app distinguishes missing answer routes from an unreachable server. OpenAPI route presence is not treated as proof that AI providers work.
- EN/AR, RTL, local account isolation, greeting, vibration, large camera, one Stop button and the glass bar remain in place. This change adds no native dependencies; the existing development build can load it through Metro.

**Real camera-based AI answers are not available yet.** The answer client is prepared, but the shared server does not implement its answer endpoint on this revision.

## Local installation completed

The teammate's database implementation is running in a new local MySQL instance, not a connection to an unknown remote team database. Create a real account once in the app, then use the same account on the dashboard.

| Component | Local setup |
| --- | --- |
| MySQL Community | 8.4.13, `127.0.0.1:3307`, `C:\Users\user\mysql84` |
| Schema | `aether_multimedia`; teammate-owned `frames` plus backend-owned `users`, `login_sessions`, `sessions` |
| Existing MySQL | 8.0 on port 3306 left intact |
| Shared account backend | `http://192.168.1.103:8002` on the current Wi-Fi address |
| MediaMTX | `http://192.168.1.103:8889`; RTSP port 8554; ICE UDP port 8189 |
| Python environment | `mobile/native/.runtime/team-integration/python`, Python 3.12.12 |
| Private settings | `mobile/native/.runtime/team-integration/local.json`, excluded from Git and restricted to this Windows user/SYSTEM |
| Private frame files | `mobile/native/.runtime/team-integration/stored_frames` |

MySQL was downloaded from [Oracle's official 8.4 download page](https://dev.mysql.com/downloads/mysql/8.4.html). The ZIP matched the published MD5 `7b94489d5524dea9b27097068bea25a8` before extraction. The portable installation follows the [official Windows archive setup](https://dev.mysql.com/doc/refman/8.4/en/windows-install-archive.html).

Application credentials have access only to the Aether schema. Database passwords and the JWT secret stay in the private local settings and server environment; they are never Expo public variables. No teammate `.env` or source file was edited. The launcher imports teammates' unchanged services using environment configuration.

## Open the app

From the repository root:

```powershell
npm.cmd --prefix mobile/native run start:team
```

This checks MySQL 8.4 and the frame schema, starts the shared account backend and MediaMTX if needed, then starts Metro for the development build. It prints this laptop's current Wi-Fi addresses. Only implemented account/media services are started; the unfinished voice and multimedia HTTP APIs are not needed for this setup.

On the iPhone, join the same Wi-Fi and reopen the installed Aether development build. Use the Metro link it prints. In Aether Connection set the backend/media addresses above (or the current ones printed), enable private-LAN HTTP for this trusted development network, save and sign up/log in. Saved settings take precedence over build-time defaults.

Ctrl+C stops app services started by that launcher, including their child processes. MySQL and services that were already running stay running. For backend/media without Metro use `npm.cmd --prefix mobile/native run services:team`; for a read-only route check use `npm.cmd --prefix mobile/native run check:team`.

Do not use the root `npm start` for this setup: it expects different Python environments/configuration outside mobile. If moving to another computer, install MySQL 8.4, create the schema/account following `multimedia/database/README.md`, install both teams' requirements into a Python environment, and privately supply the configuration keys read by `scripts/team-stack.mjs`. Never commit `local.json` or the frame/data directories. Back up the local database before reinstalling or removing its data directory.

## Verified results

- TypeScript and lint passed.
- **59 Node tests + 32 native component tests passed.** These include answer correlation, missing/failed APIs, authorization, cancellation, profile updates, retired-connection migration and server provenance, stream ordering, EN/AR, History, session controls and glass navigation.
- iOS and Android production JavaScript exports passed.
- Teammate database suite: **84 tests passed, including all 15 opt-in real MySQL integration tests** (none skipped).
- Teammate frame smoke test passed: metadata, Arabic text, native JSON/1536-element vectors, JPEG readback, ordering, account-independent session isolation, targeted deletion and persistence through another Python process. Synthetic test frames were cleaned up.
- **17 live backend acceptance checks passed**: signup, password-hash/profile persistence, duplicate rejection, login/logout, stream registration/discovery/ownership, cross-account isolation and persistence through a second backend process. The native production clients also exercised real HTTP routes with a test cookie adapter.
- Live schema inspection confirms `/api/v1/ask`, `/api/v1/questions` and `/api/v1/status` are not mounted.

The automated HTTP acceptance tests use a Node/Python cookie store. The following additional checks were performed on the user's iPhone on 2026-11-07, with user confirmation and matching server evidence:

- Signup reached MySQL: one real account with a scrypt password hash and a login session was present. The account stayed signed in after fully closing and reopening the app.
- Display-name editing showed success and updated Home; the phone's profile PATCH returned 200.
- The user confirmed live camera preview and the spoken opening greeting.
- The initial stream failure was caused by a saved media address of `192.168.1.3` instead of `192.168.1.103`. Added development-only origin/error diagnostics exposed the cause. Correcting the saved address restored publishing; no fallback backend was used.
- MediaMTX established the phone's peer connection and received one H.264 track on the same session UUID registered in MySQL, on two successive starts.
- The user confirmed Stop closed the camera immediately. The latest session had `status=ended` and an `ended_at` timestamp; MySQL had zero live sessions and MediaMTX had no active paths.
- The user confirmed that signing out and fully reopening the app stayed at sign-in. The phone's logout returned 204 and subsequent current-user requests returned 401.

This verifies the core iPhone account and stream lifecycle. It does not establish sustained video quality: the longer first stream logged packet loss/H.264 packet-processing warnings, and candidate logs included virtual network adapters. The later short Start/Stop test had no such warning in its observed log window. Sustained playback, Arabic/VoiceOver, wake phrase/vibration and background interruptions were not newly exercised in this round. Real visual answers and answer TTS remain blocked by the unfinished teammate endpoint; phone answer requests currently return 404. No real frame-to-answer success is claimed.

Re-run live checks from `mobile/native` with the account backend running:

```powershell
.\.runtime\team-integration\python\Scripts\python.exe scripts/verify-team.py database
.\.runtime\team-integration\python\Scripts\python.exe scripts/verify-team.py backend
```

The tests create only synthetic accounts/frames and clean only their own records. Logs and package inventory are in `.runtime/team-integration/`; no API provider requests are made.

## What teammates still need to deliver

| Owner | Missing work on main | What mobile needs |
| --- | --- | --- |
| Web / AI backend | `routes.py`, `assistant.py`, `memory_client.py`, `vision_provider.py` are placeholders | Implement authenticated `POST /api/v1/ask`; call multimedia search; return a grounded answer with the matching question ID/language, uncertainty and evidence IDs. Provide configured provider credentials on the server. |
| Web / AI backend | `history.py`, question/status/health routes are placeholders | Implement `GET /api/v1/questions`, `/api/v1/status`, `/health`. Clarify account authorization, retention, pagination and delete/clear semantics before History synchronization. Use MySQL for shared question storage; replace the unused legacy `QUESTION_HISTORY_PATH` example when implementing the service. |
| Multimedia | Processing primitives and frame database are implemented, but `pipeline.py` is a placeholder; `VideoReader` accepts local files | Add a live RTSP reader and orchestrate extraction/filtering/OCR/vision/embeddings/storage for `live/{session_id}`. A registered session or connected video alone does not put frames into MySQL. |
| Multimedia | `api/app/main.py` mounts no routes; routes/search service are placeholders | Implement `/api/v1/search`, `/api/v1/frames`, authorized `/api/v1/frames/{id}/image`, and `/health` using the shared contract. Keep private file paths internal. |
| Multimedia | Expiry timestamps exist; no expiry worker/retrieval API | Add retention cleanup and retrieval/search (Task 11). This is distinct from the mobile app's 24-hour local History. |
| Shared backend owners | Current stream service lacks crash expiry/tombstones; JWT logout revokes refresh but an issued access token can last 15 minutes | Agree session liveness/expiry and late Start-after-Stop handling; decide whether immediate access-token revocation is required. Mobile ordering/cancellation cannot resolve an uncertain request already executing on the server. `consent_given` is also never set by the current stream route; define the intended consent contract. |

Mobile History remains per-account, per-server **local AsyncStorage**, not yet synchronized to MySQL. The server History API and deletion contract are missing. Local snapshots are not presented as server evidence. Server evidence IDs are retained, but protected evidence images cannot be fetched until the image API is implemented.

Speech recognition and synthesis still use the device adapters (`expo-speech-recognition`, `expo-speech`). The separate `mobile/voice-service` HTTP endpoints are placeholders on main; native speech does not depend on them. The legacy PWA/older Expo tree was not migrated in this change.

## Copy to teammates

Mobile now uses the real MySQL-backed account/profile/stream APIs. We verified the MySQL 8.4 frame repository and live HTTP authentication/session isolation. Please implement the remaining answer, History, multimedia search/image and live RTSP pipeline endpoints on the shared contract.

For each native session, mobile uses one UUID for registration and publishing:

```text
POST {backend}/api/v1/streams/start {"session_id":"<uuid>"}
WHIP {media}:8889/live/<uuid>/whip
RTSP rtsp://<media-host>:8554/live/<uuid>
WHEP {media}:8889/live/<uuid>/whep
POST {backend}/api/v1/streams/stop {"session_id":"<uuid>"}
```

Video is H.264, video-only, targeting 1280x720 at 15fps. Spoken questions are recognized on the phone and sent as text:

```json
{"session_id":"<uuid>","question_id":"<uuid>","question":"Read the sign","language":"en"}
```

Expected complete JSON response:

```json
{"question_id":"<same uuid>","answer":"<grounded answer>","language":"en","uncertain":false,"evidence_frame_ids":["<frame uuid>"]}
```

There is **no streaming-answer protocol in the current contract**. For incremental answers, agree SSE/WebSocket endpoint, authentication, ordered event schema, question/session IDs, final/error/cancellation events and reconnection rules first. Mobile currently waits for the complete JSON response before speaking; it does not claim incremental text/audio streaming.

Please supply the backend/media service origins and server-side provider configuration when ready. Do not send database passwords to the phone or put them into `EXPO_PUBLIC_*` variables.
