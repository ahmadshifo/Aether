# Local preview and later native builds

## Using the real Aether backend

The app now talks to the real backend (`web/ai-backend`), not only the test fixture: same accounts as the web dashboard, and the dashboard's **Connect** finds the stream.

1. On the laptop, start the backend so phones can reach it: `.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8002` (in `web/ai-backend`), and start MediaMTX.
2. In the app's **Connection** screen: turn on the private-LAN switch, set the server to `http://<laptop IP>:8002` and media to `http://<laptop IP>:8889`, and save.
3. Build an APK with `AETHER_LAN_HOST=any` so it keeps working when the laptop's Wi-Fi address changes. `EXPO_PUBLIC_AETHER_HOST=<laptop IP>` prefills the first launch.

Answers are still demo answers until `/api/v1/ask` exists on the backend.

## Current verified preview

On 2026-11-04 the laptop Wi-Fi address was `192.168.1.103`. It is different from the VMware virtual adapter addresses. This address can change after reconnecting to Wi-Fi. The fixture and Metro were started with hidden process windows, and their health was verified from the laptop using the LAN address. Phone reachability has not been tested.

| Service | URL / port | Verified process |
| --- | --- | --- |
| Isolated SQLite fixture | `http://192.168.1.103:18063/health` | PID 35536, `node dev-server/server.mjs --lan` |
| Expo Go Metro | `http://192.168.1.103:8083/status` | listener PID 10740; launcher PID 25244 |
| Go launch address | `exp://192.168.1.103:8083` | SDK 58 manifest verified |
| MediaMTX | Intended origin `http://192.168.1.103:8889` | Not running; not needed for Go preview |

Live records: `validation/artifacts/live-services.json` and `.runtime/processes.json`. Logs: `.runtime/fixture.log`, `fixture-errors.log`, `metro.log`, `metro-errors.log`. PIDs/URLs are observations from this run, not permanent reservations. These processes must remain alive and the laptop awake during the preview. No user terminal is required for the currently launched hidden processes.

**Next phone step:** while the phone and laptop are on the same trusted Wi-Fi, open Safari and visit `http://192.168.1.103:18063/health`. Success is JSON containing `aether-native-fixture`, `sqlite`, and `demo`. This tests reachability only and does not log in. If it fails, report the visible error; do not change the firewall or install anything as a guessed fix.

After that succeeds:

1. Open an existing Expo Go installation that supports SDK 58, and use `exp://192.168.1.103:8083` (or the QR printed by a foreground `npm start`). If Expo Go is absent or reports incompatible SDK, resolve that specific app/version step first. A Go scan cannot add WebRTC or speech-recognition native modules.
2. First launch opens **Connection**. Enable **Private LAN development HTTP**, set backend to `http://192.168.1.103:18063`, and media to `http://192.168.1.103:8889`. Save. Localhost defaults are safe placeholders, not phone-to-PC addresses.
3. Create a new test account inside the app. Do not reuse sensitive passwords or send credentials in chat. Existing PWA/MySQL accounts are unrelated. The expected next screen is Welcome, then Home.
4. Choose Start and approve camera when requested. Go labels native recognition/streaming unavailable. Use the explicitly labeled typed development question, such as “Read the sign,” to exercise the demo receipt, device speech and local History. Typed input is saved as typed, never recognized speech.
5. Stop using **Stop options → Stop** or the release-inside hold gesture. Test Replay, EN/AR, History, Clear Cancel/confirm, logout and account separation. Only mark results verified after observing them.

Allow local-network permission when the OS asks. If no sound plays, inspect volume, available language voices and iPhone silent mode; initial playback and Replay both need testing. The app reports TTS errors and does not animate fake audio progress. OS recognition later may use an online system service. Do not download models for this task.

## Restart only these two services if they stop

Use two PowerShell terminals. Keep both open while testing:

```powershell
Set-Location 'C:\Users\user\Aether\mobile\native'
npm run fixture -- --lan
```

```powershell
Set-Location 'C:\Users\user\Aether\mobile\native'
npm start
```

If either port is occupied, identify the owner before proceeding. Do not stop unrelated processes. The foreground Expo command prints the current address/QR; use that if the laptop address changes. No public tunnel or firewall change is included. `scripts/expo.mjs` confines configurable Expo settings/compiler scratch files to `.runtime`; npm uses `.npm-cache`.

To stop foreground services, press Ctrl+C in each of those terminals. To stop the hidden services from this run:

```powershell
Set-Location 'C:\Users\user\Aether\mobile\native'
.\scripts\stop-preview.ps1
```

That script checks the saved PID, command line and creation time before stopping a recorded listener. It refuses a reused/mismatched PID. It does not delete accounts, History, source or logs. `.runtime/accounts.sqlite3` is preserved across restarts. Automated tests clean only their own random disposable files/accounts. Do not delete the ordinary database or device store to reset a screenshot.

## Reproduce software checks

Node 22.20.0 and npm 11.6.1 were used; the selected Expo SDK requires a supported Node version including ^22.13.0. From this folder:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:ui
node scripts/expo.mjs install --check
npm run config:check
npx --yes expo-doctor@1.21.6
npm run export
npm run audit
```

`npm ci` is app-local and uses the lockfile. Node's SQLite/type-transform experimental warnings are expected on Node 22. Expo Doctor currently exits 1 for WebRTC's untested New Architecture metadata; do not suppress it. `npm audit` reports unresolved transitive tooling advisories; no forced incompatible SDK/Jest downgrade was used. Expo's telemetry should remain disabled for these checks; use `$env:EXPO_NO_TELEMETRY='1'` and `$env:__UNSAFE_EXPO_HOME_DIRECTORY=(Join-Path (Get-Location) '.runtime/expo-home')` before calling Doctor directly.

## Custom development build: prerequisites remain missing

The primary full app requires a binary containing `react-native-webrtc` and `expo-speech-recognition`. Package/plugin resolution and Android project generation passed; this is not compilation.

Android SDK, adb and emulator were not found in PATH or the conventional SDK directory. Java 23.0.2 exists, but no complete compatible Android toolchain/device has been verified. No Android Studio/JDK/SDK installation was performed. Once a specific compatible toolchain and authorized device are available, the app-local generation command is:

```powershell
$env:AETHER_LAN_HOST='192.168.1.103'
node scripts/expo.mjs prebuild --platform android --no-install
```

Generated files live under `android/`. They may be regenerated; keep custom configuration in app.config.js/plugins. Native compile/install is a later step after prerequisites are verified. Start Metro for an installed development client with `npm run start:dev`. Do not use a Go QR as evidence a custom binary exists.

**Full iPhone native installation blocked: build/signing route not yet available under current permissions.** Windows has no Xcode. A real iPhone IPA requires compatible iOS compilation and signing. No Mac, signing identity or permitted external build route was established. No EAS/GitHub/source upload, membership purchase, sideloading tool, iTunes/iCloud change or account setup was performed. Sideloadly does not compile the app. Any later route needs its own concrete authorization and compatibility check.

Custom binaries default to trusted HTTPS. For opted-in LAN builds, `AETHER_LAN_HOST` adds only the chosen Android host plus localhost and an explicit iOS ATS IP/domain exception. No arbitrary-load or certificate bypass is enabled. Expo Go uses its own installed network policy; this app's plugins cannot change Go. Actual ATS/Android cleartext/local-network permission behavior remains NOT DEVICE-VERIFIED. Change the host and regenerate/rebuild if the allowed address changes.

## Later real streaming acceptance

Only reuse a correctly identified MediaMTX instance or place an isolated copied configuration under `dev-runtime/`; protected streaming files stay read-only. Keep management localhost-only. Do not start it merely to make Go look connected.

The custom app requests rear 1280×720/15 FPS, audio false, H.264 preference. With the exact session UUID, use the existing MediaMTX built-in player at `http://MEDIA_HOST:8889/live/UUID`; WHEP is `/live/UUID/whep`, WHIP `/live/UUID/whip`, and RTSP `rtsp://MEDIA_HOST:8554/live/UUID`. Confirm moving phone video on the laptop. HTTP signaling and registry success alone are insufficient. Private UDP/ICE connectivity is required; an HTTPS tunnel does not provide a media relay. A new Start gets a new UUID; an old player URL does not automatically follow it.

Finish all fifteen physical acceptance items from the request using [validation/DEVICE-CHECKLIST.md](validation/DEVICE-CHECKLIST.md). Until then, do not mark the full native app/device parity complete.
