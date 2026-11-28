# Local Docker voice validation — 2026-11-27

This is the earlier voice-only validation record. The live-call extension now
requires iPhone build 14; build 13 below does not include its speaker routing.
See [the 28 November OCR and live voice report](OCR-AND-LIVE-VOICE-VALIDATION.md)
for current checks and native build links.

Feature branch: `feat/local-docker-voice`, based on main `4312b8b` after fetching
and fast-forwarding the checkout. No merge or push to main is authorized.

## Implemented

- MySQL 8.4, private RustFS and two local speech workers in Docker, with named
  data/model volumes and healthchecked startup through `npm start`.
- Supertonic 3 TTS via pinned `supertonic==1.3.1`; multilingual faster-whisper
  `small`, CPU int8, four threads, beam size 3. GPU is an optional separate image.
- Authenticated backend proxy and native in-memory capture/playback on iOS and
  Android. EN/AR/FR fallback notices appear in the active session. Foreground
  wake, repeat, speech speed and haptics keep their existing controller behavior.
- Standard voice routes/contracts/fixtures; dashboard WAV playback; no voice
  recording, generated WAV or multipart spool is saved to disk or MySQL.
- Fresh MySQL startup exposed a foreign-key collation mismatch. Backend history,
  safety and caregiver user ID definitions now match the shared ASCII user key.
  Existing tables/data are not rewritten by this fix.
- Gemini vision code/model selection remains unchanged.

## Automated checks

| Check | Result |
| --- | --- |
| Root `tests/` | No runnable tests collected; placeholders, not a passing suite |
| Backend with real Docker MySQL | 74 passed, 14 subtests passed |
| Multimedia with real Docker MySQL | 1003 passed, 7 skipped |
| Opt-in live MediaMTX/FFmpeg tests | All 6 previously skipped live tests passed separately |
| Remaining multimedia skip | Windows symlink privilege-dependent test |
| Voice endpoint unit tests | 21 passed, including a disposable Docker test run; model inference stubbed |
| Native logic tests | 167 passed |
| Native UI tests | 86 passed |
| Native typecheck and lint | Passed |
| Expo iOS and Android JS exports | Passed |
| Dashboard production build | Passed |
| Shared YAML and JSON fixtures | Parsed successfully |
| CPU and optional GPU Compose definitions | Configuration validation passed |
| MySQL/RustFS integration | UTF-8 temporary-row round trip, signed object read/write and anonymous access denial passed; own test object removed |

The corrected disposable voice-test command explicitly sets `VOICE_ROLE=tts`.
An initial run inherited the STT worker role and correctly rejected TTS routes;
the documented command was corrected and all 21 checks passed.

## Native builds

- [iPhone development build 13](https://github.com/ahmadshifo/Aether/actions/runs/46033489600)
  succeeded at `5ac1f2a`. Its native audio code matches this feature's final native
  module; subsequent changes were JavaScript, tests and documentation. Metro
  supplies the current JavaScript after installation.
- Downloaded IPA SHA-256:
  `c59a29fd51917ba04110f38b596bb0e04ace744c800f5427175a767024426c5c`.
- [Android native audio compilation](https://github.com/ahmadshifo/Aether/actions/runs/46034734345)
  succeeded at `2a0ac5f` using Expo prebuild and Gradle compileDebugKotlin.
  This is module compilation, not a complete APK or physical-device test.

## Real local inference and startup

All four long-running Compose services became healthy; storage-init exited 0.
The initial public model download took approximately 30 minutes on this
connection. Models are now cached. A separate container with **networking
disabled** successfully synthesized and transcribed a sample from those cached
weights, confirming offline inference after download.

Short synthetic samples were generated and submitted directly to STT in RAM:

| Language | Audio length | Direct TTS | Direct STT | TTS through authenticated backend | STT through authenticated backend |
| --- | --- | --- | --- | --- | --- |
| English | 2.51 s | 577 ms | 1147 ms | 639 ms | 1085 ms |
| French | 2.72 s | 562 ms | 947 ms | 725 ms | 1135 ms |
| Arabic | 2.72 s | 563 ms | 924 ms | 829 ms | 1287 ms |

Samples asked where the door is. English transcribed as "Hello, where is the
door?"; French as "Bonjour, où est la porte ?" in the direct check; Arabic as
"مرحبة أين هو الباب" directly and "مرحبا أين هو الباب؟" through the backend.
The small Arabic spelling variation and French accent variation between runs
show why these are keyword/language smoke tests, not perfect-accuracy claims.
Each run preserved the intended door question and requested language.

First TTS calls before these paired checks took 562/530/547 ms for EN/FR/AR.
These are observed single calls, not percentile statistics or a device benchmark.
VAD, phone upload, Gemini answering and playback time are additional costs.

The authenticated check created a unique temporary account, verified unauthenticated
401, signup, ready health, all three WAV/STT calls, logout and 401 again, then
removed only that account and its sessions. No voice files were created.

`npm start` launched MediaMTX, the backend, multimedia API, dashboard and Metro.
Multimedia health, Metro status and MediaMTX admin returned 200; backend auth
returned the expected 401 without a cookie. Dashboard `http://localhost:5174`
returned 200 and its auth/voice proxies returned the expected 401. Vite binds
localhost here, so use that name instead of assuming IPv4 127.0.0.1 for its page.

## Machine and data boundaries

The active Aether worktree was used because the requested Desktop path did not
exist. Other projects were not edited. An existing unrelated container owns
3307, so this laptop's ignored root `.env` uses **3308** for Aether MySQL.
Committed defaults remain 3307. Existing native MySQL and its data were left
alone. Old accounts/history/objects were **not migrated**; Docker currently has
a separate development database. The non-destructive migration guide is in
[SETUP.md](SETUP.md).

Docker Desktop was started; Python environments and project dependencies were
installed. Ngrok was installed using the verified `Ngrok.Ngrok` winget package.
Its token and a public tunnel were not configured. Existing private vision
settings were preserved in ignored service files; no credentials were committed.

## Required human checks and approvals

- Install the new iPhone IPA or build an Android development APK from this branch.
  Physically verify microphone capture, speaker routing, echo cancellation,
  interruption, wake phrase, language quality and full camera/question/dashboard
  flow. Automated checks do not establish these device results.
- Test real speakers, Lebanese Arabic, accents and background noise. Synthetic
  TTS-to-STT samples are a smoke test, not an accuracy benchmark.
- GPU inference and public HTTPS/cookie behavior remain unverified. Enter your
  ngrok token privately in your terminal. HTTP tunnels do not transport MediaMTX
  UDP ICE; use LAN or correctly configured TURN/public media/UDP-capable VPN.
- Review `mobile/` with Hassan and `multimedia/` with ahmadshifo before merging.
  Neither approval is implied by passing tests. Model/license review is also
  required before distribution because Supertonic's repository is archived and
  its weights use OpenRAIL-M.

## Commits before the final documentation report

- `782ca05` Run persistent storage and local multilingual voice in Docker
- `a713be0` Use authenticated local voice with in-memory phone audio and device fallback
- `fb2e8b7` Isolate audio callbacks between capture and playback sessions
- `e72b830` Align backend foreign keys with the shared MySQL user schema
- `5ac1f2a` Add optional GPU voice and safe local storage verification
- `c2a988f` Verify native Android audio and handle one-shot Docker initialization
- `2a0ac5f` Run Android audio compilation on the feature branch
- `5e8168a` Show local voice fallback during sessions and prevent late playback

See [the branch comparison](https://github.com/ahmadshifo/Aether/compare/main...feat/local-docker-voice)
for the final documentation commit and complete diff.

## Complete changed-file list

- .env.example
- .github/workflows/android-audio-check.yml
- .gitignore
- README.md
- docker-compose.gpu.yml
- docker-compose.yml
- docs/LOCAL-VOICE-VALIDATION.md
- docs/SETUP.md
- docs/architecture.md
- docs/decision-log.md
- docs/safety-and-privacy.md
- mobile/native/app.config.js
- mobile/native/modules/aether-audio/android/build.gradle
- mobile/native/modules/aether-audio/android/src/main/AndroidManifest.xml
- mobile/native/modules/aether-audio/android/src/main/java/expo/modules/aetheraudio/AetherAudioModule.kt
- mobile/native/modules/aether-audio/expo-module.config.json
- mobile/native/modules/aether-audio/ios/AetherAudio.podspec
- mobile/native/modules/aether-audio/ios/AetherAudioModule.swift
- mobile/native/src/screens/Account.tsx
- mobile/native/src/screens/AssistantScreen.tsx
- mobile/native/src/voice/localVoice.ts
- mobile/native/src/voice/pcm.ts
- mobile/native/src/voice/speech.ts
- mobile/native/tests/localVoice.native.test.tsx
- mobile/native/tests/pcm.test.mjs
- mobile/native/tests/sessionFlow.native.test.tsx
- mobile/voice-service/.dockerignore
- mobile/voice-service/.env.example
- mobile/voice-service/Dockerfile
- mobile/voice-service/Dockerfile.gpu
- mobile/voice-service/app/init_storage.py
- mobile/voice-service/app/main.py
- mobile/voice-service/app/routes.py
- mobile/voice-service/app/schemas.py
- mobile/voice-service/app/speech_provider.py
- mobile/voice-service/requirements.txt
- mobile/voice-service/tests/smoke_local.py
- mobile/voice-service/tests/test_synthesize.py
- multimedia/api/.env.example
- scripts/check-storage.py
- scripts/configure-local.mjs
- scripts/start.mjs
- scripts/with-env.mjs
- shared/contracts/api-v1.yaml
- shared/fixtures/voice-error.json
- shared/fixtures/voice-health.json
- shared/fixtures/voice-stt-response.json
- shared/fixtures/voice-tts-request.json
- web/ai-backend/.env.example
- web/ai-backend/app/caregiver.py
- web/ai-backend/app/history.py
- web/ai-backend/app/main.py
- web/ai-backend/app/safety.py
- web/ai-backend/app/voice.py
- web/ai-backend/tests/test_voice.py
- web/dashboard/.env.example
- web/dashboard/src/services/voiceClient.js
- web/dashboard/vite.config.js
