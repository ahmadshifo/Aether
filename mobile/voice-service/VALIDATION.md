# Voice integration validation — 2026-11-13

Git `main` was fetched and pulled with `--ff-only`; local and remote were already at `cf8f115`. After the live provider checks passed, the mobile changes were prepared on `codex/api-voice` for a new iPhone development build. Main is not merged as part of this testing step.

## Passing checks

- 29 voice-service tests: authenticated contract, EN/AR/FR routing and Unicode, exact TTS text, generated WAV-to-MP3 conversion, actual M4A decoding, malformed/oversized audio, duration limits, cleanup, missing keys, denied credentials, quota, no retries, sanitized errors, origin/CSRF checks, and account-service failure.
- 94 native Node tests, including the new API multipart/binary transport, Wi-Fi address derivation, cancellation, silence gating, transcription phase, quota pause and missing-configuration cases, plus the existing session/auth/history/streaming tests.
- 55 native component/audio-adapter tests across eight suites. New coverage includes selection of API voice in Settings, actual recorder-byte handoff through the adapter, silence without upload, Stop during recording/upload/playback, late response rejection, quota cleanup and MP3 playback lifecycle.
- TypeScript and Oxlint passed.
- Expo iOS and Android JavaScript bundle exports passed. These are **not** compiled IPAs/APKs or device tests.
- Real Uvicorn HTTP smoke check: `/health` returned 200, identified `aether-voice`, found FFmpeg and accurately reported both keys missing. Unauthenticated synthesis returned 401. The temporary test server was stopped afterward.
- Python requirements were verified with `uv pip` in the existing Python 3.13.12 team environment. `expo-audio ~58.0.12` was installed and its native config plugin added explicitly. The initial Expo install process hit a stale CLI-module import after npm changed its dependency tree; subsequent fresh CLI exports succeeded.
- `git diff --check` passed. Tracked-file SHA-256 comparison against the pre-pull baseline found no changes outside `/mobile`. The pre-existing edits in `mobile/native/INSTALL.md`, `mobile/native/src/i18n/authCopy.ts`, `mobile/streaming/mediamtx.yml` and `web/dashboard/package-lock.json` were preserved byte-for-byte and excluded from the feature commit.

## Remaining verification and limitations

- Both provider keys were subsequently configured in the Git-ignored private `.env`. Live `gemini-3.8-flash-tts` -> FFmpeg -> `whisper-large-v3` round trips passed for English ("The door is in front of you."), Arabic ("الباب أمامك.") and French ("La porte est devant vous."). Transcripts matched the phrases, apart from omitted Arabic punctuation. MP3 samples and a sanitized result manifest are in `mobile/native/.runtime/voice-live-test/`; secrets and samples are not committed. An earlier English STT-only call also passed using a synthetic Windows recording. These checks verify actual provider access and audio conversion, not phone microphone quality, listening comprehension or voice preference.
- A newly compiled development IPA, Sideloadly install, and physical iPhone tests remain. Check voice quality/latency for all three languages, microphone sensitivity in real rooms, speaker routing, interruptions, permission denial and quota errors. The energy threshold is a tested heuristic, not measured phone performance.
- The existing native speech and wake-word behavior is covered by regression tests; this turn did not conduct a new phone test.
- MySQL account validation and provider integrations were mocked in API tests. This task did not start or change the MySQL database, RustFS, media backend, or dashboard. It uses the existing public account endpoint.
- French voice is implemented. Member 2 still needs to confirm French support in `/ask`; changing STT/TTS does not implement French vision answers or the vision model itself.
- Shared `shared/contracts/api-v1.yaml` still documents Azure and EN/AR only. It should be updated by the team; this task preserves the endpoint/body/MP3 contract and keeps edits in Member 1's subtree.
- Dependency audit is not clean: the native tree still reports existing glob/minimatch tooling advisories and the pre-existing `react-server-dom-webpack 19.3.0` advisory. The new audio package is not the reported source. This native app does not serve React Server Components; upgrading its pinned React/renderer set is a separate coordinated dependency task, not evidence that the native speech feature failed. [React advisory](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3).
- FastAPI's TestClient emits a deprecation warning for its httpx compatibility path; tests pass. It can be migrated separately when the shared Python testing stack moves to httpx2.

See [README.md](README.md) for free-key creation, secure local key entry, startup, API details and the device acceptance steps.
