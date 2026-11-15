# Team integration — 15 November 2026

Latest reviewed main: `e3c705a`. Integrated into `feature/api-voice` locally. This update does not publish the branch or merge it into remote main.

## What arrived from main

71 files changed since the previous shared base. Main now includes real Gemini image answers in English, Arabic and French; camera-health alerts; SOS, contacts/calling and flashlight commands; repeat, stop, speaking speed and help commands; local time/date/battery/connectivity answers; phone battery reporting; caregiver notes and daily summaries. Android uses the classic navigation bar; iPhone keeps glass. RustFS startup uses its own working directory.

The vision backend selects current, recent or historical images, retrieves JPEG bytes from multimedia, sends them to Gemini, and saves the returned answer and evidence in MySQL. It explicitly handles missing pictures, blocked cameras, provider errors and quota limits. This is separate from speech synthesis.

## Mobile integration changes

- Resolved native package, Account and session-controller merge conflicts, retaining API voice and the new team commands.
- Kept Groq question recording separate from the device recognizer used for the short stop-speaking command. API playback now follows the same slower/faster preference as device speech. Interruption still needs physical-device testing, especially when an offline recognition language is unavailable.
- Preserved voice-provider error messages and the transcribing state alongside the new listening/answer vibrations.
- Allowed 40 seconds for an answer request, accounting for initial camera-frame collection and the provider budget. Other team requests retain their 20-second default; cancellation remains supported.
- Passed private `AI_PROVIDER`, `GEMINI_API_KEY` and `GEMINI_MODEL` settings from the local launcher configuration to the AI backend only. They are not Expo public variables.
- Extended the existing mobile database bootstrap to read the team's six feature-table declarations and match their `user_id` foreign-key charset/collation to `users.user_id`. It creates missing tables only; it does not alter existing tables or their data.

No teammate source was edited outside `mobile/`. Files outside that subtree changed only through the incoming main merge. Previously dirty files, including the dashboard lockfile and the uncommitted Azure voice work, were preserved byte-for-byte.

## Validation

- Native Node tests: 129 passed.
- Native UI/voice tests: 63 passed.
- AI backend: 39 passed.
- Multimedia: 915 passed, 79 skipped. Skipped tests are not counted as verified integrations.
- Voice service: 45 passed.
- MySQL bootstrap tests: 4 passed.
- Native type checking, lint, Expo configuration introspection and Android/iOS JavaScript exports passed.
- Live Gemini tests read a generated `EXIT 42` image in English, Arabic and French. The first English call timed out at the provider's 13-second budget; a retry succeeded in 2.46 seconds. Network/provider reliability remains a real limitation.
- A temporary account exercised the real HTTP answer endpoint with a synthetic JPEG stored via the team repository in RustFS/MySQL. Multimedia supplied the image, Gemini returned an answer, and both MySQL and the History endpoint contained the result with its evidence ID. The test account, session, question and image were then removed.
- The new settings, device and pending-note endpoints successfully queried the real database. No SOS call or caregiver message to a real user was sent.
- Starting the configured stack also ran its existing retention worker: 18 expired frame records and their 18 RustFS objects were removed with no reported failures. This was the existing retention policy, separate from test-data cleanup.

## Local setup and remaining work

The private launcher configuration is `mobile/native/.runtime/team-integration/local.json` (ignored by Git). It now includes `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.1-flash-lite` and the Google key already stored on this laptop. Do not commit this file or paste keys into chat.

Run `npm.cmd --prefix mobile/native run start:team` from the repository root to start the configured stack and Metro. The existing services are reused; restart an old AI process after changing its key or model. New builds must include expo-audio, expo-battery, expo-contacts, expo-intent-launcher and the AetherTorch module. JavaScript export is not a native compile or a physical-phone test.

The Azure TTS implementation and its previous uncommitted edits remain present, but Azure Speech key/region are still missing. A Google answer key does not configure Azure speech. Device speech remains the alternative while Azure setup is pending.

For the backend teammate:

1. Qualify `user_id` foreign-key columns consistently with the shared account schema in History, safety and caregiver table declarations. Without the mobile bootstrap, this laptop's shared MySQL schema rejects startup with error 3780.
2. French past/recent-question routing is not covered by the current `HISTORY_WORDS`/`RECENT_WORDS` patterns, which contain English and Arabic terms.
3. Answers are returned as a complete JSON response; token-by-token answer streaming was not added.
4. Distance wording is a rough visual estimate. No calibrated depth model or LiDAR/Android depth integration was added. Keep the teammate's current behavior, but do not present it as measured metres.
5. Some comments still describe placeholder answers and the environment example mentions OpenAI, although the active vision implementation is Gemini.

Next device checks: install the rebuilt app, test EN/AR/FR camera questions, stop-speaking and speaking speed with the chosen voice mode, battery display, camera pause/resume and contact permissions. Test emergency calling only with an explicitly arranged test recipient.
