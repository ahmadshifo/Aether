# Native session polish — QA and iPhone handoff

Branch: `codex/native-session-polish`. Based on `2630268`, which includes main at `3edc76d`. Do not merge until the owner completes the iPhone checks below.

## Changes

- Removed repeated storage, retention, account, playback-limit and setup paragraphs from everyday screens. Removed unavailable speed and automatic-warning settings. Kept useful errors, permission explanations and clear demo labels, in English and Arabic.
- Start and “Hey Aether” announce “Session opened. I’m ready for your question.” Arabic sessions announce “بدأت الجلسة. أنا جاهز لسؤالك.” The microphone starts after the announcement. The greeting is never saved to History.
- The existing Vibrate preference controls a session-start pulse. Wake listening releases the microphone first; vibration runs before camera acquisition. Unsupported haptics do not block a session.
- The Assistant camera occupies 84% of the normal portrait viewport. Controls get more room when large text or a short viewport requires it. One Stop session button stops immediately. Details/Answer opens the complete transcript, answer, replay and errors.
- Cancelled wake callbacks and delayed old session callbacks cannot reopen a stopped session. Resume during startup waits for the wake microphone to be released. Dialogs restore accessibility focus.

## Automated verification

Local checks on 2026-11-05:

| Check | Result |
| --- | --- |
| TypeScript and lint | Passed, no lint warnings |
| Node tests | 47 passed |
| Native component/integration tests | 25 passed |
| iOS and Android Hermes bundle exports | Passed |
| Existing local changes and untracked files | 166 pre-existing files preserved by SHA-256 |

Coverage includes authentication and account isolation, disposable SQLite auth integration, History search/delete/Undo/clear/retention, streaming protocol cleanup, language/theme behavior, screen navigation, duplicated wake events, haptics on/off, greeting order/failure, permission denial, stop/background/logout/language interruptions, late callbacks, large text, small phones and resized layouts. Component tests use mocked native hardware; layout tests are not native screenshots.

The GitHub iPhone workflow runs the same checks and compiles a physical-device arm64 development IPA on macOS. Its run on this branch is the source of truth for cloud build status. The IPA is unsigned until installed through Sideloadly. Neither compilation nor mocked tests prove physical microphone, speaker, vibration or video behavior.

## Check together on the iPhone before merging

1. Keep the laptop and iPhone on the same Wi-Fi. Connect the installed development client to the running Metro server. Re-sign/reinstall the new IPA only if needed. The usual saved backend/media addresses still apply.
2. Turn off Silent Mode and raise the volume. Enable **Say “Hey Aether”** and **Vibrate** in Settings. Return Home and say “Hey Aether”. Expect one pulse, one greeting, the large camera preview, then Listening.
3. Ask a question. Confirm the greeting does not appear in the transcript or History. Hear the answer, then open Answer and Replay. Answers are still deterministic demos, not live camera analysis.
4. Tap Stop session once. Check the camera and microphone indicators stop. Start again manually. Turn Vibrate off and repeat; no session pulse should be requested.
5. Repeat in Arabic. Check English/Arabic text, light/dark mode and enlarged text. Stop, Back, Details and full answer text must remain reachable. Check VoiceOver focus after closing dialogs.
6. Stop during the greeting; background/lock the phone during a session; reopen it. A cancelled session must not restart. Try Back → Cancel and Back → Stop. Deny camera or speech permission and verify the useful error and recovery path.
7. Confirm moving video on the laptop, then check History search, replay, copy/share, delete/Undo, clear confirmation and sign-out. This is physical-device acceptance and remains pending until performed together.

Expo documents that [iOS may suppress haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) in Low Power Mode, with system haptics disabled, or while camera/dictation is active. [Spoken replies require Silent Mode off on physical iPhones](https://docs.expo.dev/versions/latest/sdk/speech/). These OS conditions still need checking on the user's device.

Existing local edits in `INSTALL.md`, `mobile/streaming/mediamtx.yml` and `web/dashboard/package-lock.json`, plus the 163 pre-existing untracked frontend validation files, are excluded from this feature commit.
