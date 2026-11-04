# Device acceptance — entirely pending

No native simulator/emulator or connected device runtime was available. No APK/IPA exists from this run. These boxes intentionally remain unchecked. Component tests and bundles are not device evidence.

- [ ] Open a genuine custom native app containing WebRTC and recognition; verify installed module capabilities.
- [ ] Configure isolated fixture and MediaMTX origins; separate backend reachability, auth, signaling and media.
- [ ] Signup/login/me/relaunch/logout/401 and expiry using the native cookie store; account A/B private History isolation.
- [ ] All eight screen families in EN/AR, light/dark, small phone and 402×874/412×915 target layouts, long content and 200% text.
- [ ] Keyboard-open forms, Dynamic Island/punch-hole/insets, Android gesture/three-button navigation, reduced motion.
- [ ] Start once, real permission prompts, rear preview; no capture before Start and no permission labels claiming unverified grants.
- [ ] Video-only H.264 where supported; laptop MediaMTX player receives moving phone frames, not just a badge.
- [ ] Real English final transcript, labeled demo answer and audible initial automatic TTS; test Replay separately.
- [ ] Real Arabic locale and installed TTS voice; record actual supported locale, not an assumed dialect.
- [ ] History text/time/demo/input/source language, real matching photo where supported, no-photo honesty, zoom and sharing cancellation.
- [ ] Pause/resume/navigation/Back Cancel/confirm and language changes without duplicated capture or stale frames.
- [ ] Stop releases camera/microphone/peer and wake lock; next Start gets a new UUID. Old player URL remains old.
- [ ] Denials, silence, offline backend, lost Wi-Fi, registration error, background/call interruption, logout during startup.
- [ ] Relaunch retains only the verified account's local History; expiry and photo cleanup on resume/login, no browser migration claim.
- [ ] VoiceOver/TalkBack traversal, modal isolation/restoration, labels, readable status announcements and normal non-timed Stop/Clear.

For Expo Go, test only applicable native layout/auth/History/camera/TTS/typed-development features. WebRTC and recognition must remain visibly unavailable. Do not mark the full-native rows complete from Go.

Screenshot evidence folder: `validation/artifacts/`. Record runtime, OS/device or emulator, viewport, font scale, UI language/theme, timestamp and whether camera/media is synthetic for every screenshot. Use only synthetic test data and no personal photos/credentials. There are **no app screenshots from this implementation run**; the launcher PNG was visually inspected, which does not validate screen parity.

Full iPhone native installation blocked: build/signing route not yet available under current permissions. Android toolchain/device availability is also unresolved. No remote build upload, signing account, purchase, global installer or firewall change is authorized by these checklist items.
