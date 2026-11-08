# Local team stack — 2026-11-08

The laptop runs the team's existing MySQL, RustFS, multimedia API, shared account/answer API, MediaMTX, dashboard, PWA and Expo code. The private configuration and launcher live under `mobile/native`; no teammate source or dashboard files were edited during this setup. This is a local copy of the stack and database, not a connection to a teammate's computer or their saved data.

Setup was verified against `origin/main` at `72e5f0d` on `codex/mobile-french-onboarding`. The publication includes the earlier shared-account integration, French/safety notice, account History controls, stream recovery and this RustFS setup. Existing unrelated local changes are excluded.

## Start and view

From the repository root:

```powershell
npm.cmd --prefix mobile/native run start:team
```

Keep that terminal open. The launcher starts missing services and preserves existing ones. Ctrl+C stops services owned by that invocation; MySQL remains running. Restart after changing Wi-Fi so the phone and MediaMTX receive the current LAN address.

**For teammates pulling this update:** Git contains the app, launcher and setup/verification scripts. Installed programs, virtual environments, databases, images, credentials and `.runtime/team-integration/local.json` are per-machine and are not uploaded. Use your existing shared services, or install the versions below and create your own ignored configuration using the keys read by `scripts/team-stack.mjs`. Initialize MySQL using `multimedia/database/README.md`. `scripts/team-storage.py prepare` generates private RustFS credentials; `migrate` copies and verifies existing local images while the multimedia writer is stopped. Do not replace a teammate's working private configuration with this laptop's paths or database name.

| Component | Local address / setup |
| --- | --- |
| Web dashboard | http://127.0.0.1:5174 — sign in with the same account created in the phone app |
| RustFS console | http://127.0.0.1:9001 — private credentials in `C:\Users\user\rustfs\console-login.txt` |
| RustFS S3 API | `127.0.0.1:9000`, private bucket `aether-frames` |
| Shared backend | `http://127.0.0.1:8002`; phone uses the LAN address printed by the launcher |
| Multimedia API | `http://127.0.0.1:8003`, protected frame images proxied by the dashboard |
| MySQL | Community 8.4.13, `127.0.0.1:3307`, database `aether_multimedia_20261108` |
| MediaMTX | 1.21.3, WHIP on 8889, LAN ICE/UDP on 8189 |
| Expo development server | Port 8083; use the installed iPhone development build |
| Desktop PWA | http://127.0.0.1:5173 |
| Voice HTTP service | Port 8001; scaffold only, without speech endpoints |

The phone must be on the laptop's reachable LAN. The native app's existing device STT/TTS is independent of the unfinished HTTP voice service. RustFS credentials never go to the phone, Expo public variables or Git.

## Installed and configured

- **RustFS 1.0.4**, official Windows release, at `C:\Users\user\rustfs\rustfs.exe`; SHA256 verified against the release. Native Windows is the project's development/testing installation option ([RustFS documentation](https://docs.rustfs.com/en/installation/windows), [release](https://github.com/rustfs/rustfs/releases/tag/1.0.4)). Docker is not needed for this local stack.
- **Python 3.13.12**, matching the teammates' required 3.13 series. The combined launcher environment and the multimedia, backend and voice virtual environments were rebuilt using their requirements. Previous Python 3.12 environments were preserved in ignored backups. All installed dependency checks pass.
- Native, dashboard and PWA npm dependencies were checked against the repository manifests. Dashboard and PWA builds pass. Requirements are not fully locked upstream; exact package parity between computers requires the team to publish lockfiles, not just version ranges.
- The bundled **YuNet face model** loads and processes frames. OpenCV, the S3 SDK, MySQL clients and the configured provider SDKs are installed.
- **FFmpeg 9.0.1 Essentials** is installed at `C:\Users\user\ffmpeg\ffmpeg-9.0.1-essentials_build\bin` and added to the Windows user PATH for new terminals. The archive SHA256 was verified. This is the Gyan Windows build linked by the [FFmpeg download page](https://ffmpeg.org/download.html).
- Frame storage is now **`FRAME_STORAGE_BACKEND=s3`**, using the teammate's real `S3ImageStore` and `FrameRepository`. Accounts, login/stream sessions, questions and frame metadata remain in MySQL. New frame JPEGs go to RustFS, with no local-folder fallback.
- All **eight existing frame images** were copied to RustFS and checked byte-for-byte after a RustFS restart. Original local images and a pre-migration MySQL dump were preserved. Migration did not rewrite SQL rows.
- The existing **retention worker** now starts with the stack. It runs every 15 minutes and applies the configured 24-hour frame lifetime to both SQL rows and RustFS objects. Before enabling it, a dry run found no expired existing records. Questions have a separate backend History policy; clearing questions does not clear multimedia images.

Private settings: `mobile/native/.runtime/team-integration/local.json`. Database dump, logs and validation evidence: `mobile/native/.runtime/team-complete/`. RustFS keys, SQL credentials and backups stay ignored and local; the RustFS folder and setup-report folder have restricted Windows permissions.

## Validation and limits

- Publication checks on 2026-11-08: TypeScript, lint, all 76 Node tests, all 44 native component tests, and both iOS/Android JavaScript exports passed. No native dependency or build configuration changed in this update.
- 25 live storage checks passed against real RustFS/MySQL: migrated-image persistence, new object writes, duplicate protection, quarantine/restore, authenticated API retrieval, dashboard image proxy, account isolation, blocked anonymous access and scoped retention of synthetic test data.
- 24 live backend acceptance checks passed after switching to Python 3.13, including native production API clients and MySQL persistence. The known History cursor bug is reported separately; this is not a complete pagination pass.
- The broader multimedia suite ran with real MySQL tests enabled against a disposable database, without touching app accounts or questions: **975 passed, one failed, seven skipped**. The failure is the teammate test at `multimedia/tests/test_api_integration.py:115`, which expects four OpenAPI paths; the current API has five after `/api/v1/frames/keep` was added. Six skips require the separate live RTSP test run; one requires Windows symlink privilege. No teammate tests were edited to turn failures green.
- After installing FFmpeg, **all six live RTSP integration tests passed** against an owned MediaMTX instance and another disposable MySQL database. Across these runs, the suite has 981 passing tests, one stale assertion failure and one Windows symlink skip. Cloud providers were mocked in these tests.
- **Ten additional live checks passed through the running app stack**: generated H.264 video → MediaMTX → multimedia ingestion → MySQL metadata + RustFS JPEG → authenticated dashboard image retrieval → answer evidence → MySQL History. The answer remained explicitly uncertain, as expected from the unfinished vision answer implementation. Only generated test accounts/streams were removed afterward.
- Native launcher syntax/lint and Python dependency compatibility checks passed. Real paid cloud AI was not exercised: provider credentials are absent. iPhone behavior after this storage switch still needs the next device session; automated streaming checks do not establish phone reconnection behavior.

## What still needs implementation or team input

| Owner / area | Remaining work |
| --- | --- |
| Backend teammate | Implement grounded visual answers in `app/assistant.py:describe()`. It currently returns an explicitly uncertain placeholder. Adding an API key alone does not implement this step. |
| Backend teammate | Add French to Ask request/response validation, answer text, History writes and temporal question routing. The current server accepts only `en` and `ar`; mobile UI/device speech already supports `fr`. |
| Backend teammate | Preserve milliseconds in History records/cursors. Current `_iso()` truncation can skip answers at a page boundary. See `HISTORY-STREAMING.md` for the reproduction. |
| Backend teammate | Fix the History bootstrap foreign-key collation to match `users.user_id`. The mobile launcher currently adapts creation of a missing questions table without altering existing tables. |
| Multimedia teammate / configuration | Supply OpenAI and Mistral credentials through a private local configuration or approved shared backend. The pipeline needs both for its implemented vision/OCR/embedding path; live AI analysis remains off until configured. Then validate actual provider outputs, costs and failure behavior. |
| Multimedia teammate | Update the stale four-route integration assertion to the agreed current API contract. Publish locked Python dependencies for reproducible team environments. |
| Mobile, with a reachable protected image API | Add authenticated server evidence images to native History. Evidence IDs/counts already arrive; the current native UI does not download those RustFS-backed JPEGs. Use a protected API route/proxy, never direct bucket credentials. The dashboard already has an image proxy. |
| Mobile + backend, if incremental answers are required | Agree and implement an SSE/WebSocket answer protocol, cancellation and incremental speech. Current answers arrive as complete JSON responses; camera video streaming is a separate working path. |
| Mobile voice service, if dashboard server speech is required | Implement/mount the HTTP speech routes and configure the chosen provider. `mobile/voice-service/app/main.py` is currently only a FastAPI scaffold. Native iPhone recognition/speech already works without it. |
| Mobile QA | Retest the iPhone after the storage/runtime change; verify evidence display when implemented and automatic recovery after a controlled connection loss. Earlier History refresh/Undo/local removal/Cancel checks and a live camera session were user-confirmed. |

Suggested message to teammates:

> My laptop now runs your MySQL 8.4 and RustFS storage adapter, live frame ingestion, protected image API and dashboard. Please finish grounded answers, French request/History support, precise History cursors and the questions-table collation fix. I also need private provider configuration or a reachable shared backend to test real vision/OCR/embeddings. The multimedia integration test still expects four routes although `/frames/keep` makes five. Please share dependency locks and confirm the protected image route mobile should use. If incremental spoken answers are required, let's agree on the streaming response contract. I have not edited your source files.
