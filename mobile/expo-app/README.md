# EchoSight — native Expo application (Member 1)

This is React Native, with no WebView or browser speech/camera implementation. The PWA in `../frontend`, voice service, shared contracts, MediaMTX configuration and teammates' work remain unchanged. All new source, dependencies, lockfile, cache and generated files belong under this directory. No launcher or speech backend is included.

## Two capability tiers

| Feature | Stock Expo Go for SDK 58 | Custom development build |
| --- | --- | --- |
| Native navy/teal UI, EN/AR, safe areas, history/details | Yes | Yes |
| Rear-camera preview | `expo-camera` | The same video-only WebRTC camera track used for publishing |
| Device answer playback/replay | `expo-speech` | `expo-speech` |
| Real microphone transcription | Unavailable, explained in UI | Native OS recognizer, if service, permissions and language are available |
| WHIP live video | Unavailable, explained in UI | Native WebRTC to your configured MediaMTX |
| Camera AI | Demo clearly labeled when URL blank | Optional existing `/api/v1/ask`; real evidence requires the other members' pipeline |

SDK 58 package versions are selected from the installed Expo `bundledNativeModules.json`. Native additions are `react-native-webrtc` 155.0.1, its Expo config plugin 15.0.2 (declared Expo peer `>=56`), and `expo-speech-recognition` 58.0.1. The WebRTC plugin's published compatibility table stops at SDK 56; a successful SDK 58 native build and physical-device run are still required to establish compatibility. Do not downgrade packages individually or call a Metro export a native build. `package-lock.json` records the exact resolution.

`src/native/capabilities.ts` checks Expo's execution environment and installed native modules before executing literal `require` calls. Type-only imports disappear during bundling. Metro can resolve both installed packages, but Expo Go never evaluates the missing native libraries. A development binary lacking a native module falls back to the supported preview path and explains unavailable recognition. There is never an Expo camera and WebRTC camera open together.

## Windows / PowerShell: first UI test

Use `npm.cmd` and `npx.cmd` if PowerShell blocks `.ps1` scripts. Node 22.20.0 was present during implementation; follow any engine warning from your installed SDK.

```powershell
cd C:\Users\user\Aether\mobile\expo-app
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:versions
npm.cmd run check:config
npx.cmd expo-doctor
npm.cmd start -- --lan
```

Keep `.env.local` blank for the first Expo Go test. Install an SDK 58 compatible Expo Go on iPhone/Android, join the laptop's trusted Wi-Fi, scan Metro's QR code, and tap Start. Allow camera access. A real rear-camera preview should appear. Streaming/recognition remain explicitly unavailable in this tier. Tap Stop to close the camera. Open History, select the labeled sample, and Replay to test device speech without inventing a microphone transcript. Select AR and replay the Arabic sample. Voice availability varies by installed system voices. On iPhone turn silent mode OFF and raise volume. If the store's Expo Go does not yet support SDK 58, use the matching available Android Go build or a development build; an incompatible Go binary cannot run this SDK.

Preferences/history use AsyncStorage and are capped at 50 validated entries. Empty history shows a labeled sample; it is not saved as a real conversation. A real recognized question followed by a demo answer is saved with `demo: true`, language, ISO timestamp, stable question UUID and session UUID. Existing browser storage is preserved separately and is not automatically migrated. History and language changes stop the session; returning home requires explicit Start. This conservative native behavior prevents hidden recording and cross-language recognition events. Stop remains available during startup/permissions.

## Android: local development build, no cloud account required

Install Android Studio with the SDK/platform/build tools required by Expo/RN, its supported JDK, and configure `ANDROID_HOME` and `JAVA_HOME`. Connect an Android phone by USB, enable USB debugging, approve the laptop, and confirm `adb devices` lists it. An emulator is useful for UI but is not proof of real phone-camera publishing.

Set local app values in `.env.local` before building (the IP below is an example; replace it with the laptop's Wi-Fi IPv4 from `ipconfig`):

```dotenv
EXPO_PUBLIC_MEDIAMTX_URL=http://192.168.1.25:8889
EXPO_PUBLIC_AI_API_BASE_URL=
EXPO_PUBLIC_SPEECH_ON_DEVICE_ONLY=false
ECHOSIGHT_ALLOW_LAN_HTTP=1
```

```powershell
cd C:\Users\user\Aether\mobile\expo-app
npm.cmd ci
npx.cmd expo prebuild --platform android --no-install
npm.cmd run android -- --device
# On subsequent runs after installing the binary:
npm.cmd run start:dev -- --lan
```

These commands generate `android/` only under this app and download local toolchain dependencies. They are instructions for the user; they were not used to install a native app during implementation. Rebuild after adding/changing native modules, plugins, permissions or LAN HTTP policy. Avoid `prebuild --clean` if you later hand-edit generated native files.

The opt-in `ECHOSIGHT_ALLOW_LAN_HTTP=1` changes Android cleartext policy and iOS ATS to permit trusted LAN development over HTTP; it is not a production security policy. Default is off. Use a trusted TLS origin and leave the flag off for distribution. Never put passwords, signing files or secrets into `EXPO_PUBLIC_*`: these values are embedded in the app bundle. No built-in TURN/cloud service or hidden upload is configured.

## iPhone development build from Windows

Windows cannot compile or run Xcode/iOS Simulator. You can use Expo Go from Windows for the supported tier above. For full iPhone native capabilities, use a Mac with Xcode and `npx expo run:ios --device` (local personal-team signing may be possible with Apple's restrictions), or deliberately initiate a cloud development build with Expo EAS. Physical-device EAS distribution normally requires Apple Developer Program membership and Apple signing credentials; do not assume this is free. EAS cloud quotas/pricing vary. No cloud build, account registration, upload, signing operation or remote write was performed here.

An `eas.json` development profile is provided for later voluntary setup. If choosing EAS, review its current instructions, link a project yourself and register the device before running `eas build --platform ios --profile development`. That uploads source to a service and is outside this local-only task. A simulator binary cannot be installed on an iPhone. Prefer Android's local build for zero cloud cost on Windows.

## Voice: real device events, basic device TTS only

The development build calls the OS recognizer through `expo-speech-recognition`, requests microphone/speech permissions, chooses supported `en-US`/English or `ar-LB`/`ar-SA`/another Arabic locale, and displays only real results. Some Android services cannot enumerate locales; the desired locale is attempted and native language errors are surfaced. `Listening…` starts only on the native `start` event; `I hear you…` follows an actual result; a final result triggers the answer path after native `end`. No-speech gets at most two bounded retries. Other errors stop recognition with an explanation; use Stop then Start to retry.

System speech providers may send audio to Apple/Google or their configured service. This is not a guarantee of offline processing. Set `EXPO_PUBLIC_SPEECH_ON_DEVICE_ONLY=true` to require on-device support and an installed locale; the client refuses unsupported/unconfirmed offline locales instead of falling back to a network recognizer. Install the language models using system settings as needed. There is no microphone track in MediaMTX and no app recording persisted to disk. No Whisper, Azure, neural TTS, new STT/TTS endpoint or voice-service modification is included.

Device TTS selects an available voice matching the answer's language and reports missing voices/playback errors. Recognition is off during answer playback to reduce echo. Replay does not start a camera or idle recognizer. Stop/background/unmount cancels recognition, speech, timers and requests. OS recognizers have finite sessions; native availability, permissions, English/Arabic results, iPhone audio routing and repeated cancellation are **NOT DEVICE-VERIFIED**.

## MediaMTX: phone → server → laptop viewer

Use the existing unchanged `../streaming/mediamtx.yml` and a Windows MediaMTX binary obtained from the official release page. Store the binary under this app's ignored `artifacts/mediamtx/` (not root or teammate directories). In a second PowerShell terminal:

```powershell
cd C:\Users\user\Aether\mobile\expo-app
.\artifacts\mediamtx\mediamtx.exe ..\streaming\mediamtx.yml
```

Use an authorized private development network. Permit laptop TCP 8889 for signaling and UDP 8189 for ICE media in the firewall on the private network profile only; TCP 8554 is the existing RTSP reader port. Metro also needs its displayed port reachable from the phone. Don't use `localhost` on the phone for the laptop. Wi-Fi client isolation, VPNs, a stale advertised interface or a blocked UDP path can prevent video even if WHIP HTTP works. A Cloudflare Quick Tunnel provides HTTPS signaling, not UDP relay; it cannot by itself solve ICE reachability. Outside a directly reachable LAN you need explicitly configured reachable ICE candidates and potentially a separately administered TURN service. No TURN or public tunnel was created.

1. Put the laptop MediaMTX URL in `.env.local`, rebuild if changing HTTP policy, restart Metro after env changes, and open the development build.
2. Tap Start. Copy the displayed session UUID. Expect a genuine camera preview; `Streaming: connected` requires the peer's real connected event, not merely HTTP 201.
3. Confirm MediaMTX logs show a publisher on `live/<UUID>` and inspect negotiated codec (H.264 preferred if offered by the device), resolution/fps. The requested 1280×720 at 15fps is a target, not a guarantee of camera/encoder output.
4. On the laptop open MediaMTX's built-in WebRTC reader at `http://LAPTOP_IP:8889/live/<UUID>` using a compatible browser/network policy. Its WHEP endpoint is `http://LAPTOP_IP:8889/live/<UUID>/whep`. Confirm moving live phone video on the laptop; opening an endpoint alone is not proof. The processing endpoint stays `rtsp://LAPTOP_IP:8554/live/<UUID>`.
5. Tap Stop. Verify preview closes, reader stops and the publisher disappears. Start again: require a different UUID and a new reader URL. Repeat 10–20 times, including Stop while permission/WHIP is pending.

The publisher is video-only and send-only, prefers advertised H.264 codecs, gathers ICE with a deadline, posts SDP to `/live/{session_id}/whip`, validates HTTP 201 and SDP, resolves relative/absolute same-origin Location, applies the answer, handles connection failure/disconnect deadlines, and issues bounded best-effort DELETE on cleanup. If an aborted HTTP request was accepted but no response/Location reaches the app, the server may need its normal peer timeout; no client can delete an unknown resource. Stop closes the peer immediately. Camera tracks/stream are separately released even after late acquisition. There is no session reuse.

Do not expose personal footage or the MediaMTX management API publicly. This repository's server config is an unauthenticated development configuration; keep it on an access-controlled network. No configuration change was needed. Backend local discovery/management API integration remains another step; no dashboard code was altered.

## Optional existing AI request

Leave `EXPO_PUBLIC_AI_API_BASE_URL` blank for an honest demo. If the existing Member 2 service is intentionally connected, set its origin. The app sends exactly `/api/v1/ask` JSON with `session_id`, `question_id`, `question`, `language`; it validates response identity, language, answer, uncertainty and evidence ID fields. Stop aborts the request; a 20-second timeout bounds it. HTTP/API errors stay errors and are not silently replaced with demo success.

Visual evidence is supplied through the agreed live stream / processing pipeline. The shared ask contract has no photo-upload field or snapshot endpoint, so this app deliberately does not invent one or upload local JPEGs. Native still-photo capture/upload for individual visual queries remains pending an agreed contract. Camera preview or a returned string alone does not establish visual grounding. Full backend integration is **NOT DEVICE-VERIFIED**.

## Checks and manual acceptance

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:versions
npm.cmd run check:config
npx.cmd expo-doctor
npm.cmd run export:check
```

See `VALIDATION.md` for the actual tool results. Metro exports validate JS module resolution for iOS/Android; they do not compile Swift/Kotlin/C++, grant device permissions, load native modules on a phone or prove a video stream. Generated `dist-check`, `.expo`, native build directories, node_modules and npm cache are ignored locally.

Physical acceptance still required: Expo Go start/stop camera and demo Replay; development-build English and Arabic recognition; supported/unsupported offline locales; denial then settings recovery; silent mode and missing TTS voice; VoiceOver/TalkBack reading order, labels, history modal and large text; small phone/RTL/landscape tablet presentation; background during permissions, streaming, recognition, AI and playback; rapid Start/Stop; unreachable URL, HTTP 403, missing UDP, network loss; MediaMTX real publishing and laptop live playback; repeated new UUID sessions with camera/microphone indicators extinguished after Stop. Backgrounding stops the entire session; resuming requires Start. The UI does not force a global RTL reload and uses local Arabic writing/alignment and mirrored rows.

Later work with the user: Whisper and advanced TTS/backend work; agreed snapshot integration; full AI/frame grounding verification with teammates; physical-device compatibility fixes and final visual/accessibility polishing. Nothing here changes any shared schema or teammate service.

References: [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Expo Speech and iPhone silent mode](https://docs.expo.dev/versions/latest/sdk/speech/), [development builds and host/signing requirements](https://docs.expo.dev/develop/development-builds/introduction/), [native speech recognition](https://github.com/jamsch/expo-speech-recognition), [WebRTC Expo plugin](https://github.com/expo/config-plugins/tree/main/packages/react-native-webrtc), [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc), [MediaMTX WebRTC readers](https://mediamtx.org/docs/usage/read).

No staging, commit, push, merge, PR, stash modification, branch switch or remote repository write is part of this work.
