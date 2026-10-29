# Local validation — 2026-10-29

Initial branch: `feature/mobile-react-native-expo`. Initial `git status --short`: clean. Branch preserved. Only `mobile/expo-app/**` was added; existing tracked repository files were not changed.

| Check | Actual result |
| --- | --- |
| Dependency installation | Completed locally; app-owned package-lock and npm cache |
| `npm ls --depth=0` | Clean installed dependency tree |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 16 tests |
| `expo install --check` with network access | PASS, dependencies up to date |
| `expo config --type prebuild` | PASS, plugins resolve |
| `expo config --type introspect --json` | PASS, iOS speech/camera descriptions and Android camera/audio permissions present |
| `expo-doctor` 1.21.5 | 19/20 PASS; one check fails because React Native Directory marks `react-native-webrtc` untested on New Architecture |
| iOS Metro/Hermes export | PASS |
| Android Metro/Hermes export | PASS |
| Native source audit | No DOM, browser storage/camera/speech APIs, WebView, or server voice calls in app source |
| Existing-path diff audit | Empty; PWA, voice-service, streaming config, web, multimedia, shared contracts, docs and root files unchanged |
| Android native compilation / installation | NOT RUN; no connected Android/adb toolchain established |
| iOS native compilation / installation | NOT RUN; Windows host has no Xcode |
| Physical phone / live MediaMTX / laptop WHEP | NOT DEVICE-VERIFIED |

The WebRTC metadata warning has not been excluded or suppressed. Its package declares React Native `>=0.60.0`; the config plugin declares Expo `>=56`. These metadata checks and passing JS bundles do not establish SDK 58/New Architecture native compatibility. Resolve any native compilation/runtime issues during the documented Android/iPhone acceptance run before describing this as working end-to-end.

Tests exercise real-event logic through fakes, without inventing a successful physical run:

- Expo Go evaluates the capability gate without importing absent native WebRTC/speech libraries.
- Stop before late acquisition releases the resource once; 20 independent lifetimes clean up despite a failing disposer.
- History corruption, duplicate IDs, timestamps, Arabic fields and the 50-entry cap.
- Translation key parity and same-language locale selection.
- Immutable ask JSON contract/shared session ID, response identity validation and abort propagation.
- Missing recognition capability, Stop during permission, denial, interim/final/end ordering, network errors and detached stale listeners.
- WHIP send-only/video-only behavior, SDP POST, relative Location resolution, connected-event status, DELETE cleanup, cancellation during ICE, late POST cleanup, HTTP failure and refusal to reuse stopped peers.

Initial sandbox attempts could not execute Hermes or the test runner's user-info lookup; reruns with approved local execution passed. Type checking found and corrected the removed RN 0.88 StatusBar backgroundColor prop. Expo Doctor found and corrected a direct `expo-modules-core` dependency; the app now uses Expo's exported API. No failing application check is hidden by disabling validation. Native feature tests remain manual.

The generated `dist-check/` bundles and `artifacts/config-introspect.json` are local ignored outputs, not screenshots or a signed native build. No public tunnel, cloud build, backend/server upload or GitHub operation was performed. No stage, commit, push, merge, PR, stash modification, branch switch, fetch/pull or remote repository write occurred.

Read `README.md` for the exact PowerShell install, Expo Go, Android build, iPhone signing, MediaMTX, voice and repeat Start/Stop acceptance steps. Remaining work includes device verification, agreed native still-frame query integration, full visual grounding through the team pipeline, Whisper/advanced TTS in the later authorized phase, and device-driven polish.
