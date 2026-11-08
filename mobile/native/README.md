# Aether native app

Latest setup: [Local team stack with RustFS](TEAM-SETUP.md) (2026-11-08), following [History and streaming recovery](HISTORY-STREAMING.md) and [French and the first-use safety notice](FRENCH-ONBOARDING.md). The mobile integration is implemented; a backend cursor precision bug still blocks complete History pagination. Visual AI and French backend answers also remain pending.

Expo/React Native application with EN/AR/FR, light/dark themes, a glass navigation bar, foreground wake phrase, camera streaming and device speech.

**Accounts, stream sessions and server History use the team's real MySQL-backed backend.** Display names can be edited in Settings. Questions go to the shared answer API; the app speaks and saves validated server responses. The current endpoint returns an uncertain placeholder rather than a grounded visual answer.

## Run the current integration

From the repository root:

```powershell
npm.cmd --prefix mobile/native run start:team
```

This starts the local MySQL 8.4 instance, RustFS image storage, shared account backend, multimedia API/retention worker, MediaMTX, dashboard, PWA, voice scaffold and Metro. Open the installed development build on the same Wi-Fi, save the backend/media addresses printed by the launcher and create a real account once. The same account works with the teammate dashboard at http://127.0.0.1:5174. No database or RustFS credentials belong on the phone.

See [TEAM-INTEGRATION.md](TEAM-INTEGRATION.md) for installed components, validation, configuration, teammate action items and exact API/media contracts. [INSTALL.md](INSTALL.md) contains earlier device-build instructions; use this page's launcher for current services. No native dependency changed in the integration, so an existing compatible development build can reload the JavaScript.

## Implemented and pending

- MySQL-backed signup/login/logout/profile, account-linked stream registration and fail-closed account ownership.
- Device STT/TTS, spoken greeting, optional vibration, large camera view, one Stop control, speech replay, EN/AR/FR and RTL. First-use safety notice with voice and a Help replay option.
- Video-only WHIP publishing to MediaMTX, a short disconnect grace period, three bounded reconnection attempts and manual Retry stream. A connected transport and a registered session are separate states.
- MySQL History refresh, pagination controls, offline cache and explicit account-wide server clearing. Up to 50 answers from the last 24 hours are cached per account/server in AsyncStorage; online pages can exceed 50. Individual removal affects only the local copy. The current backend loses timestamp precision in cursors; see the linked report before treating pagination as complete.
- Full-answer JSON client with cancellation, response correlation, uncertainty/evidence metadata and truthful errors. No canned-answer generator or alternative account server remains in the active app.

Native WebRTC lacks a supported question-time snapshot API in this adapter, so text History can exist without a photo. Expo Go provides a development preview with typed API input, but speech recognition and WebRTC require the installed development build.

## Verification

See [TEAM-SETUP.md](TEAM-SETUP.md) for current setup checks and the teammate handoff. Earlier iPhone checks covered accounts, greeting, H.264 publishing, Stop, glass navigation and the safety notice. History refresh, local removal/Undo and cancelling account clearing were also user-confirmed. Automatic recovery after a controlled connection loss, sustained stream quality and the unfinished visual-answer pipeline remain open.
