# OCR and live voice validation 2026 11 28

Branch: `feat/local-docker-voice`. No merge to main. This extends the previous
Docker/local speech work documented in LOCAL-VOICE-VALIDATION.md.

## Implementation and boundaries

- PaddleOCR 3.7.0 / PaddlePaddle 3.3.1 run in a CPU Docker worker with cached
  PP-OCRv5 mobile models for English, Latin/French and Arabic. Read-text questions
  bypass generative vision. Low confidence returns no candidate text and a
  translated move-closer answer. Blank images have a separate no-text response.
- Existing OCRResult fields are preserved; status/confidence are additive.
  The retired cloud OCR SDK, key settings and current-source documentation were removed.
  Gemini remains the scene/vision provider. Reading intent is separate from loose
  summary-topic matching, so List objects and sign-colour questions still use vision.
- Typed caregiver notes UI, routes and phone polling are replaced with live audio.
  Old database rows remain. Direct DTLS-SRTP WebRTC carries audio; authenticated,
  short-lived one-use tickets protect WebSocket signaling. Same-account ownership
  is the existing linkage model; separate caregiver invitations/roles are not implemented.
- Phone chime/announcement, assistant speech pause, end button/voice commands and
  native speaker routing are implemented. Ordinary call conversation is not sent
  as assistant questions. SOS ends the call; camera commands remain available.
  New native builds are required. Real handset behavior remains to be accepted.
- Only call metadata is persisted. Ended metadata expires on an hourly 24-hour
  sweep. There is no media recorder, audio upload/storage path or saved SDP in this feature.

## Commands and outcomes

Commands run from the repository root with logs in Windows TEMP. The with-env
wrapper loads private root settings without printing credentials. Real SQL tests
used this checkout's Docker MySQL on port 3308, because another project owns 3307.

| What ran | Result |
| --- | --- |
| `node scripts/with-env.mjs multimedia api/.venv/Scripts/python.exe ../tests/stack_persistence.py` | PASS: isolated new Compose project, new SQL/S3 volumes, all five workers healthy; stop/start retained UTF-8 row and S3 object |
| `npm.cmd start` | PASS: Compose health, schema initialization, MediaMTX, backend, multimedia, dashboard and Metro all started from the launcher |
| `node scripts/with-env.mjs multimedia api/.venv/Scripts/python.exe ../scripts/check-storage.py` | PASS: real UTF-8 MySQL round trip, private RustFS upload/download, anonymous object access refused |
| `web/ai-backend/.venv/Scripts/python.exe mobile/voice-service/tests/smoke_local.py` | PASS: real CPU TTS and STT in all three languages, RAM-only audio; measurements below |
| `multimedia/api/.venv/Scripts/python.exe tests/ocr_benchmark.py` | PASS execution and blank case; Arabic abstained on two degraded samples, detailed below |
| `node scripts/with-env.mjs web/ai-backend .venv/Scripts/python.exe ../../tests/live_voice_browser.py` | PASS: real browser WebRTC audio, start/stop/restart, network loss then successful new call, denied/missing mic, quick cycles, account isolation and visible UI |
| Root `pytest tests -q` using multimedia Python | 7 passed; worker HTTP/confidence/input-boundary tests with stubbed inference |
| Backend `pytest tests -q`, AETHER_MYSQL_INTEGRATION=1 | 104 passed, 14 subtests passed |
| Multimedia `pytest tests -q`, RUN_MYSQL_TESTS=1 | 952 passed, 7 skipped |
| Multimedia `pytest tests/test_live_integration.py -q`, RUN_LIVE_TESTS=1 and RUN_MYSQL_TESTS=1 | 6 passed using real owned MediaMTX/FFmpeg processes; only the Windows symlink privilege skip remains |
| Disposable Docker voice unit tests | 21 passed; inference stubbed for endpoint/error cases |
| `npm.cmd --prefix mobile/native test` | 167 passed, including live-call cancellation and existing command/battery regressions |
| Native `test:ui`, `typecheck`, `lint`, `export` | 86 UI tests passed; typecheck/lint and both iOS/Android JS exports passed |
| Dashboard `npm run build` and oxlint through native's pinned binary | Build and lint passed |
| Compose CPU, optional OCR GPU and optional speech GPU definitions | Configuration validation passed; GPU inference not hardware-tested |
| Shared OpenAPI and JSON fixtures | Parsed successfully, version 1.2.0 |
| `ngrok config check` | BLOCKED: installed, but no config/token exists; no HTTPS microphone test claimed |

The fresh-stack test reuses downloaded model volumes while creating fresh database
and object volumes. It does not claim a second cold download of all speech models.
Its containers were removed afterward; its two named test-data volumes remain.
Existing user records, objects, native MySQL and unrelated project services were not removed.

The multimedia test count changed because obsolete provider-SDK-specific tests
were replaced by local OCR contract tests. The root worker tests and real OCR
benchmark provide additional coverage. TestClient emits one upstream deprecation
warning about httpx; it does not fail the suites.

Startup HTTP checks: voice/OCR readiness, multimedia health, Metro status and
dashboard returned 200. Unauthenticated backend auth correctly returned 401.
MediaMTX's admin path list returned 200. Its root is not a webpage (404 is expected); its live integration tests
exercise actual streams instead. The dashboard test uses isolated browser contexts.

## Native build results

- [iPhone development build 14](https://github.com/ahmadshifo/Aether/actions/runs/46166436348)
  succeeded at `1d4fcc2`, including Swift compilation, native tests and JS exports.
  Later OCR/docs commits do not change its native modules; Metro supplies their current JS.
- [Android native audio compilation](https://github.com/ahmadshifo/Aether/actions/runs/46166434077)
  succeeded at the same commit. This compiles the Kotlin module after Expo prebuild;
  it is not a full APK installation or physical-phone test.
- The previous iPhone build 13 lacks live-call speaker routing. Install build 14
  for the combined local speech and live-call handset acceptance test.

## Real speech measurements

One short synthetic utterance per language, CPU, on this laptop. These are observed
single-call latencies, not percentiles or microphone/phone end-to-end latency.

| Language | TTS ms | STT ms | Recognized text |
| --- | ---: | ---: | --- |
| English | 712 | 1165 | Hello, where is the door? |
| French | 535 | 1205 | Bonjour. Où est la porte ? |
| Arabic | 672 | 1041 | مرحبا، أين هو الباب؟ |

All preserved the source question; punctuation differed slightly. Generated audio
length was 2.51/2.72/2.72 seconds. This does not measure Lebanese dialect accuracy,
noise robustness, echo cancellation or physical-device barge-in.

## Real OCR results

Pillow-generated Arial fixtures: clean, 14-pixel small text, 12-degree rotation,
Gaussian blur and low contrast in each language, plus a blank image. Windows
Arabic shaping used arabic-reshaper/python-bidi. The font itself is not committed.
The committed images and expected logical text allow repeating the benchmark.

| Language | Accepted samples | Mean CER including abstentions | Mean latency | Range |
| --- | ---: | ---: | ---: | --- |
| English | 5 of 5 | 0% | 147.8 ms | 130–169 ms |
| French | 5 of 5 | 0% | 143.4 ms | 134–164 ms |
| Arabic | 3 of 5 | 40% | 136.8 ms | 128–158 ms |

Expected phrases: EXIT 24; Sortie numéro 24; الباب رقم ٢٤. Arabic clean, rotated
and low-contrast samples matched exactly. Small Arabic scored about 0.79 and blurred
Arabic about 0.84, below 0.85, so both returned empty text/status unclear. Counting
those as deletions gives 40% mean CER; accepted Arabic samples had 0% CER. This is
safe abstention on this tiny set, not a claim of broad Arabic accuracy.

The blank image returned no_text and no text. Low-confidence handling is also
tested through translated backend answers. The service does not invent completions,
but any OCR model can make confident mistakes; thresholds are not proof of correctness.
Detailed per-image JSON is reproducible with tests/ocr_benchmark.py.
The real backend OCR client was also called against the running Docker service:
clean English/French/Arabic returned their exact text, and small Arabic returned
the translated move-closer answer with uncertain=true.

## Real live audio test

Two isolated Chromium pages used the actual dashboard sender and authenticated
backend signaling. A synthesized in-memory microphone pulse reached the simulated
phone through real WebRTC; inbound RTP bytes and audio energy were measured.
The last run observed 103, 103 and 113 ms for start, restart and restart after
network restoration. All were below the 500 ms target on loopback only.

Both unauthorized start (403) and unauthorized join (404) were refused. Invalid
WebSocket tickets are covered by backend tests. Quick cycles released every sender
track. Denied mic and missing mic produced their distinct messages. Network loss
closed the call and required an explicit new Start; no automatic hidden recording.

The audit found no recorder or audio persistence path. The test creates its own
accounts/sessions and removes only those. Actual call media travels peer-to-peer;
the backend persists metadata only. OS memory/swap is outside this guarantee.

## Failures found and corrected

- Reusing summary substring rules could send List objects or sign-colour questions
  to OCR. Added separate multilingual reading-intent routing and regression cases.
- The initial existing backend process lacked the newly installed WebSocket runtime.
  Added uvicorn[standard] and restarted the owned process; real signaling now passes.
- The first simulated audio receiver lacked an HTML media sink. Fixed the test
  harness and verified RTP plus audio energy rather than connection state alone.
- Offline simulation exposed a sender cleanup gap. Added offline handling and
  heartbeat liveness to both clients; successful real audio after reconnection is tested.
- Updated obsolete cloud-OCR mocks and the scene test whose Read the sign case
  correctly moved from Gemini to OCR. New tests explicitly prohibit generative fallback.
- Removed an unused dashboard import and avoided a GET/HEAD request body.

## Remaining acceptance checks

1. Install the new iPhone build and test speaker, chime, announcement, voice hangup,
   screen hangup, microphone echo, SOS cancel, camera off/on, Stop and background.
2. Have Hassan test the Android development build on a physical device. Native
   compilation is not an APK installation or a device acceptance test.
3. Configure ngrok privately to test HTTPS mic permissions. Cross-network media
   needs an independently configured TURN/UDP solution; HTTP tunnels alone are insufficient.
4. GPU OCR/STT are optional and not verified on this CPU-only test machine.
5. Review real-camera OCR, dialects and important text with consenting users.
   Gemini cloud-answer quality was not newly benchmarked by these local-model tests.
6. Existing global frame-retention deletion was not activated against user data.
   Follow the dry-run/owner-approved worker instructions in SETUP before retaining personal data.

Review mobile changes with Hassan and multimedia changes with ahmadshifo.
Merge waits for the user's physical testing and approval.
