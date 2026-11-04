# Mono parity checklist

Source: local `mobile/frontend/` at HEAD `bb54dbd94bd30c9842bd3c34cb8afd57eb31c88a`, branch `feature/mobile-auth-mono-backup`, inspected 2026-11-04. This replaces the initial pre-implementation checklist with actual results. No old Expo source was used. Local auth is the earlier SQLite implementation; `streamRegistry.ts`/`streams.py` and newer main b9612cf were absent and were not fetched.

Implemented/tested means the named software/mocked-component test, not physical acceptance. All actual native pixels, fonts, keyboards, safe areas and screen-reader results remain NOT DEVICE-VERIFIED.

| Family / behavior | Native counterpart | Status / evidence |
| --- | --- | --- |
| Auth | Mono landing, login/signup, native inputs/password-manager hints, show/hide, validation, pending/cancel/retry/outage and private lock | Implemented/tested EN/AR components and controller races; real SQLite integration + live disposable account |
| Welcome | Brand/copy, deferred camera/mic explanations, account/environment preference, Get started, safety | Implemented/tested components; no mount/login permission acquisition |
| Home | Verified greeting, Connection, brand card, Start, five selection-only question cards, private recent History | Implemented/tested routes; cards present prompts without generating recognition/answers; fan pixels unverified |
| Assistant | Camera area, transcript/phase, Demo/Evidence not provided receipt, cassette Replay, confirmed Back/Stop, no tab bar | Implemented/tested state and components, 20 Start/Stop lifetimes; actual media/audio pending |
| History | Search/groups/expand/details, original language, real optional photo/zoom, Replay/Stop speech/copy/share/delete/Undo/confirmed Clear, distinct empty/loading/error/no-photo | Implemented/tested repository and component actions, share dismissal and Clear Cancel; native sheets/photos pending |
| Settings | Verified identity, global language controls, per-owner motion/haptics, unavailable voice settings, Clear alternatives, Connection/Help and real logout | Implemented/tested routes and logout controller |
| Help | Source examples/Arabic stamps, native settings permission link, Stop guidance, assistive safety, OS speech/demo disclosure | Implemented/tested EN/AR content; hardware settings link pending |
| Connection | Public origin recovery, ticket ID and stopped state, copy, separate reachability/current auth/signaling/registration/preview/peer status | Implemented/tested validation/components/local health; MediaMTX absent and no connected stream claimed |
| Identity/lifecycle | Verified-owner stores, source + UUID namespace, recheck, immediate logout/background/unmount retirement, stale generations | Implemented/tested A/B/environment separation and async races; native cookie lifecycle pending |
| Native recognition | Real start/interim/final/end/error, locale detection, bounded retry, no raw audio persistence | Development build only; mocked final/echo lifecycle passes; real EN/AR recognition pending |
| Device TTS | Single owner, matching language, callbacks, cancellation/deadline, idle Replay without capture | Implemented/tested with mocked API; initial automatic playback, silent mode and voices pending |
| Demo answers | Exact Room205 EN/AR text, labeled screen/History, camera-off only when camera actually off | Implemented/tested; no AI/Phase3 calls, Go typed input explicitly marked |
| WebRTC/WHIP | Rear 1280x720/15 request, audio false, same preview stream, send-only/H.264 preference, bounded ICE/POST/DELETE, actual peer state | Development build only; protocol/race mocks pass; New Architecture warning and moving phone-to-laptop video unverified |
| Registry | Same UUID, existing start/stop body/path, fixture ownership/tombstones, independent failure | Implemented/tested against SQLite; newer production response parity unverified because source absent |
| Expo Go | Same native views, fixture auth, local History, Expo camera/TTS, typed dev test, missing modules gated lazily | Software tested; live SDK58 manifest served; actual phone startup/cookies/camera/TTS pending |
| Native snapshots | No supported frame/photo API in inspected RTC155 track; text with No photo saved | Precise blocked parity gap; no second camera or fabricated image |
| Go snapshots | Question-time CameraView capture, generation/owner check, app-private JPEG and stale cleanup | Implemented/tested matching/cancellation mocks; physical photo pending |
| Retention | 50 entries, 24h, 1.5MB/photo, 20MB total, revision queues, single Undo photo lease, startup/resume purge | Implemented/tested; physical deletion can wait for account login/resume/storage recovery |
| Design | Exact light tokens, bundled Inter/Pirata One/JetBrains Mono/Noto Sans Arabic, eye mark/icons, restrained dark mapping | Token/key tests pass; launcher PNG inspected; no app screenshot evidence |
| RTL/responsiveness | Component direction and row reversal without app reload; History retains language; fan fallback; safe area/keyboard container | Component navigation at 402x874 and 412x915 with fontScale2; no layout engine/pixel proof. Small phone/device matrix pending |
| Accessibility | >=48 controls, larger Stop, modal/focus intent, normal Stop/Clear, release-inside cancellation, reduced motion | Structural/gesture tests pass; VoiceOver/TalkBack/focus restoration pending |
| Motion | Tactile presses, hold labels, receipt reveal; no fake waveform/progress/duration | Native adaptation: static logo and stable text replace CSS trace/English scramble. Arabic never scrambled. Detailed motion fidelity pending |

Full iPhone native installation blocked: build/signing route not yet available under current permissions. Android SDK/adb/emulator not found; Java alone is insufficient. No APK, IPA, device screenshot, microphone transcript, audible playback or physical stream is claimed. See [device checklist](validation/DEVICE-CHECKLIST.md).
