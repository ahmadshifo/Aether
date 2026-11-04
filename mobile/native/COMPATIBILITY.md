# Compatibility evidence — 2026-11-04

The official `expo-template-blank-typescript@58.0.32` npm tarball was extracted under `.runtime/template` without running a Git scaffold. Stable versions: **Expo 58.0.23, React 19.3.0, React Native 0.88.1, TypeScript 6.0.3**, React types 19.3.0. Expo's engine includes Node ^22.13.0; installed **Node 22.20.0 / npm 11.6.1 / PowerShell 7.6.5** qualifies. Python's WindowsApps alias failed; the fixture uses Node SQLite (experimental warning on Node 22).

| Runtime package | Exact installed version |
| --- | --- |
| expo-dev-client | 58.0.18 |
| react-native-webrtc | 155.0.1 (M155) |
| @config-plugins/react-native-webrtc | 15.0.2 (peer Expo >=56) |
| expo-speech-recognition | 58.0.1 |
| expo-speech / expo-camera | 58.0.3 / 58.0.14 |
| expo-file-system / AsyncStorage | 58.0.13 / 2.2.0 |
| react-native-safe-area-context / react-native-svg | 5.11.1 / 15.16.0 |
| expo-font / expo-haptics | 58.0.11 / 58.0.7 |
| expo-clipboard / expo-sharing | 58.0.4 / 58.0.22 |
| expo-crypto / expo-constants | 58.0.7 / 58.0.15 |
| expo-keep-awake | 58.0.3 |
| expo-status-bar / expo-system-ui | 58.0.4 / 58.0.7 |

The lockfile records the complete exact tree. `expo install --check` reports up to date; `npm ls --depth=0` exits 0. No beta/canary, force/legacy-peer override, or unsupported architecture workaround was used.

Test tooling: Jest 30.5.2, jest-expo 58.0.14, @react-native/jest-preset 0.88.1, react-test-renderer 19.3.0, oxlint 1.89.0. React DOM and react-server-dom-webpack 19.3.0 are **development-only Jest Expo peer requirements**. Application source imports neither; it uses native views, no WebView/HTML or React Native Web. A mismatched react-dom 19.3.1 resolution was corrected to matching 19.3.0 without force. A registry timeout recovered on retry using the app-local cache.

## Unresolved native warning

Expo Doctor 1.21.6: **19/20 pass, exit 1**. React Native Directory marks WebRTC **Untested on New Architecture**. This warning is not suppressed. The config-plugin maintainer's compatibility table trails this Expo58/RTC155 combination despite its broad peer range. Peer acceptance, native config generation, and Metro exports do not prove native compilation. Verify Fabric/RTCView, getUserMedia, transceivers and audio ownership in a real build. SDK55+ does not support disabling New Architecture.

Android prebuild passed with `newArchEnabled=true`; no APK was compiled. Android SDK/adb/emulator and an authorized attached Android runtime were not found. Java 23.0.2 alone is not a complete compatible toolchain. Windows has no Xcode; no iOS generation/compilation/signing success is claimed.

## Native decisions

- HTTP uses `expo/fetch`. Its installed native source implements redirect rejection and credential omission/inclusion, avoiding known global RN fetch caveats. Native cookie persistence/relaunch/revocation remains NOT DEVICE-VERIFIED. Tokens are never copied into AsyncStorage; cross-origin redirects are rejected and media calls omit credentials.
- HTTPS is default. Explicit private LAN HTTP requires validated bare origins and UI opt-in. Build-time `AETHER_LAN_HOST` accepts one private IPv4 or `.local` name. Android XML denies global cleartext, allowing that host plus localhost. Main/debug/debugOptimized flags remain false. Backup is disabled and external media/storage permissions are removed.
- iOS sets arbitrary loads false and declares local-network usage; opted-in builds add local networking and an explicit host/IP ATS exception. Current Apple guidance distinguishes iOS17+ IP exceptions. Introspection confirms values; actual iOS26.6/Android behavior remains NOT DEVICE-VERIFIED. Expo Go's installed network policy cannot be changed by this app's plugins.
- WebRTC and recognition load lazily behind Go/installed-module checks. RTCView and WHIP share one video-only stream. No globals registration, fake DOM, canvas, WebView or competing camera. H.264 capability absence is tested; preference is not proof of negotiated output.
- RTC155's inspected MediaStreamTrack has no supported photo/frame API. Native History honestly retains text with No photo saved. Go uses CameraView.takePictureAsync only while it owns preview, at question time.
- Permission prompts serialize, queued prompts cancel before acquisition, and iOS inactive transitions during permission UI do not cancel Start. Actual background releases capture and locks identity. Restart is explicit.
- TTS selects an installed voice matching the answer language; absence reports an error. Recognition prefers ar-LB then ar-SA/available Arabic, and supported English. System services may be online. Initial automatic speech, silent mode, actual locales and audio interaction remain device checks.

## Remaining npm advisories

Final `npm audit`: **26 findings (25 moderate, 1 low; zero high/critical)**, exit 1. These are propagated dependency findings centered on glob, minimatch and deepmerge in Expo/Jest tooling, not 26 independently demonstrated app exploits. Nonbreaking `npm audit fix` was attempted without eliminating them. Remaining suggestions include incompatible Expo/Jest/plugin downgrades; none were forced. Reassess compatible upstream fixes before distribution. Full report: `validation/artifacts/npm-audit.json`.

Advisories: [glob traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), [deepmerge poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).

## Primary evidence inspected

- [Expo SDK58](https://docs.expo.dev/versions/v58.0.0/), official template/package manifests and installed declarations.
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/), [New Architecture](https://docs.expo.dev/guides/new-architecture/).
- [WebRTC maintainer](https://github.com/react-native-webrtc/react-native-webrtc), [config plugin](https://github.com/expo/config-plugins/tree/main/packages/react-native-webrtc), installed native/module source.
- [Recognition maintainer](https://github.com/jamsch/expo-speech-recognition), [Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/), [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/).
- [RN networking](https://reactnative.dev/docs/network), installed Expo native fetch implementation.
- [Android security config](https://developer.android.com/privacy-and-security/security-config), [Apple ATS local networking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).
