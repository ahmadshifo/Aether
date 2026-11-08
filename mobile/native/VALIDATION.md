# Current integration validation — 2026-11-07

Current publication checks and live RustFS/MySQL results: [TEAM-SETUP.md](TEAM-SETUP.md). Older results below are historical.

Current History/recovery update (2026-11-08): see [HISTORY-STREAMING.md](HISTORY-STREAMING.md) for the mobile changes, current checks and backend pagination blocker. Older results below are historical.

Latest validation and remaining device checks: [FRENCH-ONBOARDING.md](FRENCH-ONBOARDING.md), updated 2026-11-08. Results below describe the previous revision.

The current evidence and reproducible commands are in [TEAM-INTEGRATION.md](TEAM-INTEGRATION.md). Older runtime artifacts are historical and do not describe the active database setup.

| Check | Result |
| --- | --- |
| TypeScript / lint | Passed |
| Node tests | 59 passed |
| Native component tests | 32 passed |
| iOS / Android JavaScript exports | Passed |
| Teammate database tests | 84 passed, including all 15 real MySQL tests |
| Frame persistence smoke test | Passed against MySQL 8.4.13, including a separate Python process |
| Live backend acceptance | 17 checks passed, including native production HTTP clients |
| Physical iPhone with this integration | Signup, login persistence, profile edit, greeting, H.264 publishing, Stop cleanup and logout persistence passed; see limits below |
| AI provider / live frame-to-answer pipeline | Blocked by unfinished teammate endpoints and pipeline |

Logs are under `.runtime/team-integration/`: `unit-tests.log`, `ui-tests.log`, `export.log`, `database-tests.log`, `backend-tests.log`, and `live-backend-results.json`. Private config is excluded from Git; synthetic acceptance-test accounts and frames are removed after testing.

The interactive phone test is recorded in TEAM-INTEGRATION.md and `phone-test-results.json`. Phone signup/profile/logout requests and MediaMTX publishing/cleanup are in `services-v2.log`; native streaming diagnostics are in `start.log`. A mistyped media address was corrected. One longer stream logged packet loss; sustained playback quality and full EN/AR/accessibility regression are still open. Development stream-error diagnostics passed TypeScript, lint and all six WHIP tests after being added, and were exercised on the phone.

Code edits remain in `mobile/native`. The initial protected-file baseline and final audit are in `.runtime/team-integration/before.json` and `scope-audit.json`. Existing local edits and teammate files are preserved. Work is on `codex/mobile-team-integration`; publishing this feature branch is authorized, with no merge into `main`.
