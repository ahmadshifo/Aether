# History and streaming recovery — 2026-11-08

Mobile implementation is in `mobile/native` on `codex/mobile-french-onboarding`. Existing French/onboarding work is preserved. This report records the implementation stage; current setup, publication validation and teammate handoff are in [TEAM-SETUP.md](TEAM-SETUP.md).

## History

- `GET /api/v1/questions` uses the existing authenticated backend and MySQL storage. Refresh, Retry and Load older answers are exposed in English, Arabic and French.
- Cursor pages are validated, deduplicated by question ID and sorted newest first. A live answer and its server copy appear once; local photos/input metadata are preserved while cached. Online pages can exceed the 50-answer offline cache.
- Outages retain available answers and show a retry state. Expired login locks the account. Cancelled/late responses cannot restore data after Clear, logout or disposal.
- Demo records are excluded. History covers the server's 24-hour window; the local cache retains at most 50 answers. Search covers loaded answers and explicitly offers older pages when available.
- **Clear account history** requires confirmation, stops any active session, and uses `DELETE /api/v1/questions`. Cache is cleared after the server confirms success. An uncertain response keeps the cache and reports that deletion could not be confirmed.
- **Remove local copy** has Undo and sends no DELETE. Refresh can bring the server record back. Settings still offers local-only clearing. The server currently has no individual-question delete endpoint.
- Clearing questions does not delete separately managed multimedia frame records or files.
- The app does not infer server deletions merely from an incomplete page. Cached answers can remain until expiry/local clearing unless the server explicitly reports an empty account or account clearing succeeds.

## Backend issue found by live QA

The real server advertises another page but can return an empty page when two answers were stored in the same second. `questions.asked_at` is `DATETIME(3)`, while `auth._iso()` formats seconds only. `history._record()` uses that formatter, and `history._cursor()` encodes its rounded value. The next-page SQL comparison therefore skips records with milliseconds in that second. Non-empty pages can also omit such records; the mobile client cannot reconstruct data the server skipped.

The app preserves cached answers and reports an unexpectedly empty next page as a load failure. This is protection, not a backend fix. Live refresh, clear and account isolation pass; **complete server pagination remains blocked**.

Send the backend owner:

> Please preserve `asked_at` precision when serializing History records and creating cursors in `app/history.py`. The database uses `DATETIME(3)`, but `_iso()` currently truncates to seconds. Reproduce with two rows in the same second at different milliseconds and `limit=1`; following `next_cursor` must return the second row. Also test identical timestamps with the question-ID tie-breaker and a dense page boundary. Mobile consumes cursors as opaque strings and already supports the corrected contract. Please keep changes in your backend subtree.

No teammate backend or multimedia source was edited. French backend answers, grounded visual answers, evidence-image integration and incremental answer streaming are separate previously documented work, not completed by this change.

## Streaming

- A transient `disconnected` state gets four seconds to recover on the existing peer.
- Failed negotiation or sustained loss creates a fresh peer on the same camera and session UUID. Retries wait 1, 2.5 and 5 seconds; after exhaustion the app reports preview-only failure and offers **Retry stream**. Thirty seconds of stable connection renews the retry budget.
- Stop/background/logout retire the publisher and cancel pending timers. Late callbacks and WHIP POST responses cannot reopen a stopped session. Created WHIP resources are deleted even when their response arrives after cancellation.
- The launcher prefers Wi-Fi, ignores common virtual adapters and rejects unassigned explicit addresses. MediaMTX advertises the selected address and binds UDP/ICE to it. Restart the launcher after changing networks.
- Existing services are left running; the launcher warns if their ICE configuration differs. During this task the active local MediaMTX configuration was updated with zero active sessions, to `192.168.1.103:8189`, with interface gathering disabled.
- The [MediaMTX configuration reference](https://mediamtx.org/docs/references/configuration-file) documents the address/gathering settings. An isolated v1.21.3 server answered a synthetic WHIP offer with only `192.168.1.103` candidates. This proves advertised addressing, not real video transport or phone recovery. No TURN service or internet-wide reachability is claimed.

## Validation

- TypeScript and lint pass.
- 76 Node tests pass, including pagination beyond the cache limit, duplicate prevention, offline/retry, failed/late clear, account locking, cursor errors, recovery bounds, stable recovery, Stop during retry and LAN selection.
- 44 native component tests pass, including History's offline/retry/pagination/confirmed-clear flow in EN/AR/FR and the existing onboarding/session/navigation tests.
- 24 live backend acceptance checks pass using generated synthetic accounts. HTTP and direct SQL checks prove that deleting account A's History leaves account B's History available. The native production clients also exercise real refresh and server clearing. Synthetic accounts are removed by the verifier; real account History was not cleared.
- The same-second pagination case fails against the unchanged backend and is explicitly recorded as blocked, not counted as passing.
- iOS and Android JavaScript exports pass. All 357 protected-file hashes remain unchanged; task edits are confined to `mobile/native`.

Reproduce from `mobile/native`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:ui
npm.cmd run export
node scripts/verify-lan-media.mjs
& .runtime/team-integration/python/Scripts/python.exe scripts/verify-team.py backend
```

The last two require this laptop's installed MediaMTX/private team setup. The isolated media check uses ports 18889, 18189 and 19997. Evidence is in ignored `.runtime/history-streaming/`; no secrets belong in committed reports.

Phone follow-up: reload the installed development build; test History Refresh, local Undo and a deliberate confirmed clear using a disposable account; interrupt Wi-Fi briefly during a session and verify recovery; test Stop during backoff and background/return. Those new physical-device behaviors have not yet been verified.
