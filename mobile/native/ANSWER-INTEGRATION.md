# Mobile answer integration

This update connects the mobile launcher to the team's Gemini image-answer service and makes the new feature tables compatible with the shared MySQL account schema. Speech recognition, speech synthesis and their dependencies keep the existing main-branch behavior.

## Private answer configuration

Add these fields to the existing local `mobile/native/.runtime/team-integration/local.json` configuration:

```json
{
  "AI_PROVIDER": "gemini",
  "GEMINI_MODEL": "gemini-3.1-flash-lite",
  "GEMINI_API_KEY": "your-private-key"
}
```

Keep the existing database, Python, storage and other configuration fields. The file is ignored by Git. The launcher forwards these answer settings only to the AI backend; they are not Expo public variables. A phone using an already configured shared backend does not need its own provider key.

From the repository root, run `npm.cmd --prefix mobile/native run start:team`. The launcher reuses services that are already running, so restart an older AI-backend process after changing its key or model. This configures Gemini image answers; it does not configure a speech provider.

## MySQL compatibility

Before starting the backend, the launcher reads the six feature-table declarations from the team's History, safety and caregiver modules. For missing tables, it matches the `user_id` foreign-key charset/collation to the existing `users.user_id` column. This prevents MySQL error 3780 with the shared `ascii_bin` account IDs while keeping answer/message text Unicode.

The bootstrap uses `CREATE TABLE IF NOT EXISTS`. It does not alter existing tables, reset the database, or delete records. The backend owner can eventually qualify these foreign-key columns consistently in the original declarations; no backend source files were changed here.

## Request timing and checks

The mobile answer request allows 40 seconds for initial frame collection and the vision provider. Other team requests retain their 20-second default. Both timeout and user cancellation are still enforced.

Run the mobile Node tests with `npm.cmd --prefix mobile/native test`. With the project Python dependencies installed, run `python -m pytest mobile/native/tests/test_prepare_team_history.py -q` to verify the bootstrap against the actual team declarations.

Live integration was checked on 15 November 2026: a synthetic JPEG stored through the team repository in RustFS/MySQL reached Gemini through the real answer endpoint, and the answer and evidence were returned by History and persisted in MySQL. Temporary test records and the test image were removed afterward. English, Arabic and French provider responses were verified; one initial English call timed out before a successful retry. Provider/network failures remain possible.

The contact/call permission sequence also stops when its session has been cancelled or the account is no longer active. The API speech feature is being developed separately and is not part of this update.
