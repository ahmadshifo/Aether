# Aether native app

Expo/React Native application with EN/AR, light/dark themes, a glass navigation bar, foreground wake phrase, camera streaming and device speech.

**Accounts and stream sessions use the team's real MySQL-backed backend.** Display names can be edited in Settings. Questions go to the shared answer API; the app speaks and saves only valid server answers. That endpoint is still unfinished on main, so visual answers currently show an unavailable message.

## Run the current integration

From the repository root:

```powershell
npm.cmd --prefix mobile/native run start:team
```

This uses the local MySQL 8.4 instance, shared account backend, MediaMTX and Metro. Open the installed development build on the same Wi-Fi, save the backend/media addresses printed by the launcher and create a real account once. The same account works with the teammate dashboard. No database credentials belong on the phone.

See [TEAM-INTEGRATION.md](TEAM-INTEGRATION.md) for installed components, validation, configuration, teammate action items and exact API/media contracts. [INSTALL.md](INSTALL.md) contains earlier device-build instructions; use this page's launcher for current services. No native dependency changed in the integration, so an existing compatible development build can reload the JavaScript.

## Implemented and pending

- MySQL-backed signup/login/logout/profile, account-linked stream registration and fail-closed account ownership.
- Device STT/TTS, spoken greeting, optional vibration, large camera view, one Stop control, speech replay, EN/AR and RTL.
- Video-only WHIP publishing to MediaMTX; a connected transport and a registered session are separate states.
- Per-account/per-server local History in AsyncStorage (24 hours, 50 entries maximum). Only entries carrying server provenance are accepted. Server History synchronization awaits the teammate API and deletion contract.
- Full-answer JSON client with cancellation, response correlation, uncertainty/evidence metadata and truthful errors. No canned-answer generator or alternative account server remains in the active app.

Native WebRTC lacks a supported question-time snapshot API in this adapter, so text History can exist without a photo. Expo Go provides a development preview with typed API input, but speech recognition and WebRTC require the installed development build.

## Verification

See [VALIDATION.md](VALIDATION.md) and [TEAM-INTEGRATION.md](TEAM-INTEGRATION.md). Unit/component tests, iOS/Android exports, real MySQL tests and live account/session HTTP acceptance passed. The user also tested signup, login persistence, profile changes, greeting, H.264 publishing, Stop and logout persistence on iPhone, with matching server evidence. Sustained stream quality and the unfinished real-answer pipeline remain open.
