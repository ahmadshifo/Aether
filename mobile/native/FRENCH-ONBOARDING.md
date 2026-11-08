# French, first-use safety notice and latest team update

Updated 2026-11-08 on `codex/mobile-french-onboarding`.

Historical implementation record: subsequent account-history clearing, stream recovery and RustFS installation are documented in [HISTORY-STREAMING.md](HISTORY-STREAMING.md) and [TEAM-SETUP.md](TEAM-SETUP.md). The Git/publication statements below describe the original implementation stage.

## Git and ownership

Fetched and merged `origin/main` at `72e5f0d` into a new feature branch based on the previously published mobile integration. This incorporates teammates' changes without merging our branch into main. New implementation edits are inside `mobile/native`; pre-existing local edits and teammate source files are protected. This feature work has not been pushed.

## Mobile behavior

- English, Arabic and French interface dictionaries; French prompts, dates, greeting, recognition locale and device TTS. Arabic retains RTL. Language selection persists across app launches.
- A versioned, installation-level safety notice appears before sign-in or the signed-in app. Existing installations also see it once after this update. Explicit acknowledgement is stored locally; reinstalling/clearing app data shows it again. Failure to save acknowledgement keeps the notice visible with Retry through the same Continue button.
- Notice: “Aether does not replace your white cane or guide dog. Keep using your usual mobility aids. Aether can make mistakes and cannot guarantee that a route is safe.” Arabic and French translations are included.
- The notice attempts automatic narration in the selected language, with Replay and Stop controls. VoiceOver/TalkBack users receive focused notice text without competing automatic TTS. Missing voice/audio failure keeps the complete text visible; playback stops on background, language change, acknowledgement and unmount. A French voice must be available on the phone.
- Help includes “Review safety notice” to replay the notice after acknowledgement without clearing account data. Help pauses active session speech and disables wake listening while the notice can speak. During phone troubleshooting, a development-only diagnostic confirmed the notice was already acknowledged; the temporary diagnostic was then removed.
- Latest teammate History import is adapted to the mobile server-answer model: validated real records retain uncertainty and evidence IDs; sample/demo records are excluded. This is a local cache of server History. Local deletion does not delete server records, which can reappear after refresh. Server deletion endpoints remain absent.
- The backend currently rejects `fr`: the phone reports this explicitly without translating or retrying in English. Full French answers require backend changes described below.

## Dependencies and local services

Installed manifest dependencies for `mobile/native`, `mobile/frontend`, `web/dashboard`, `web/ai-backend`, `multimedia/api`, and `mobile/voice-service`. Created the missing backend and multimedia Python environments used by the root launcher, and updated the existing mobile integration environment. All four Python environments passed dependency compatibility checks. No tracked lockfiles were rewritten.

Use the mobile-owned configured launcher from the repository root:

```powershell
npm.cmd --prefix mobile/native run start:team
```

It starts the shared account backend, MediaMTX, multimedia API/live ingestion, and Metro using ignored local configuration. Local JPEG storage is configured; the optional RustFS/S3 server is not required or installed. The S3 client dependency is installed. Provider AI analysis is off; no provider credentials were invented or paid requests made. The legacy voice-service dependencies are installed, but native speech uses the device and does not require its unfinished HTTP endpoints.

Current local addresses: backend `http://192.168.1.103:8002`, media `http://192.168.1.103:8889`, Metro `http://192.168.1.103:8083`, multimedia API `http://127.0.0.1:8003`. The launcher prints current LAN addresses; these can change.

## Local database update

The new canonical account schema is incompatible with the previously installed account tables. Instead of altering or dropping existing data, setup created `aether_multimedia_20261108` on MySQL 8.4 port 3307, initialized the new canonical schema, copied and compared every shared field, and switched only the ignored mobile configuration after validation. One account, one login record and six session records were preserved; no frames existed. The original `aether_multimedia` database remains intact, including its older extra columns. The previous configuration is backed up privately beside `local.json`.

In MySQL Workbench refresh Schemas and open **aether_multimedia_20261108** to inspect the active database. The older saved connection may still default to `aether_multimedia`.

The new backend's History DDL has an incompatible foreign-key character set: `questions.user_id` inherits the default UTF-8 collation while canonical `users.user_id` uses `ascii_bin`. `scripts/prepare-team-history.py` creates a missing History table with the existing account identifier's character set/collation before starting the backend. It uses the team's declaration, never alters existing tables, and does not edit backend source. The backend owner should correct the declaration upstream so this bootstrap is no longer needed.

## Validation

- TypeScript and lint passed.
- 62 Node tests passed, including French API validation, server-history metadata, and demo exclusion.
- 41 native component/adapter tests passed, including all three safety languages, acknowledgement persistence/failure, reopening the acknowledged notice from Help, screen-reader behavior, missing voice, language changes, background cancellation, French forms and French recognition selection.
- iOS/Android JavaScript exports passed; dashboard and legacy mobile frontend production builds passed.
- Teammate multimedia unit/API tests: 468 passed, one skipped. These are not physical camera or live-provider evidence.
- Updated MySQL canonical schema check passed.
- 17 live backend acceptance checks passed, including the production native HTTP client receiving an uncertain answer and retrieving its real MySQL-backed History record. Synthetic accounts and their records were cleaned up. No real visual AI answer was claimed.
- Physical iPhone French pronunciation, first-use layout/VoiceOver, persistent language choice and new live-ingestion behavior still require a device test. Earlier device results in TEAM-INTEGRATION.md describe the previous revision.

Logs and protected-file audit: `.runtime/french-onboarding/` (ignored).

## Send to the Web/AI teammate

Mobile now supports `en`, `ar`, `fr` and sends the chosen language unchanged. Please extend `AskRequest`/`AskResponse` in `app/routes.py`, the language check in `app/history.py`, and the answer text/mode detection in `app/assistant.py` to French. Keep response language and question ID matching the request. The current `/ask` implementation still has no vision model; connect real evidence-based generation before claiming visual answers.

Please also align `questions.user_id` with canonical `users.user_id` (`CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`) in the table declaration, and provide authenticated delete/clear History APIs if deletion must synchronize across devices.
