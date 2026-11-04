# Mobile authentication integration — local review

Implemented 2026-11-02 on `feature/mobile-auth-local`. All authentication changes remain unstaged and uncommitted. This document supersedes the demo-logout and global-History descriptions in the earlier `IMPLEMENTATION-NOTES.md`; that document remains the historical redesign handoff.

## Merge and ownership

- Previous GitHub main: `18e4a63276400a9e1dc00c17e4ac0d21e10370bc`.
- Reviewed redesign: `e4341cf914ac96b924740be99552280e3ec96ff0`.
- Verified and pushed normal two-parent merge: `8280f1db11d77d993de61a8a380dcb1d9adf8687`.
- The merge introduced exactly the 15 reviewed `mobile/frontend/` paths. All other trees matched the previous main. Database commits `d7065036815f9e1f7f2120727096f6f0422868fe`, `62954ec42905f50ecc3f38da87e77cd60be16be6`, and `18e4a63276400a9e1dc00c17e4ac0d21e10370bc` remain ancestors. No database setup or MySQL command was run.
- Merge work used a detached worktree outside the project, retained at `C:\Users\user\AppData\Local\Temp\echosight-auth-ee20e3a7775f4da7a3d195adac01f76b\merge`.
- The auth branch starts at that merge and has no tracking remote. No auth commit, push, PR, deployment, or further Git mutation was performed after its creation.
- `voiceSession.ts`, `whipPublisher.ts`, network clients, shared contracts, PWA registration/configuration, backend source, and teammate areas remain protected. Vite changes are confined to the explicitly authorized auth proxy. No dependencies or lockfiles changed for auth.

## Existing backend contract

The unchanged implementation is `web/ai-backend/app/auth.py`, mounted by `app/main.py`. It uses SQLite, not the newly added MySQL schema.

| Request | Body | Successful response |
| --- | --- | --- |
| `POST /api/v1/auth/signup` | `{name, email, password}` | 201 `{user}` and session cookie |
| `POST /api/v1/auth/login` | `{email, password}` | 200 `{user}` and session cookie |
| `GET /api/v1/auth/me` | none | 200 `{user}`, or 401 when signed out |
| `POST /api/v1/auth/logout` | none | 204; revokes token and deletes cookie |

`user` contains `user_id`, `email`, `name`, and `created_at`. The client validates the shape, UUID and timestamp. Passwords are preserved exactly, including whitespace. Signup uses the backend's 1–80 character trimmed name, valid email up to 254 characters, and 8–128 Unicode-code-point password bounds. Confirmation never leaves the frontend. API error codes, including duplicate email, wrong credentials and the existing 15-minute login rate limit, have EN/AR messages. No OAuth, reset, verification, refresh-token, profile-editing or fictional endpoint was added.

The existing service uses scrypt password hashes and hashes of opaque session tokens. The browser manages `echosight_session`, an HttpOnly, SameSite=Lax cookie. No password, cookie value or credential is persisted in frontend storage, URLs, tests' output, or logs. Test credentials are generated in memory. A cookie login token is never used as a `live/{session_id}` streaming UUID.

## Frontend ownership and state

`authClient.ts` is the typed `AuthClient` boundary. Requests use relative URLs, same-origin credentials, `cache: 'no-store'`, a ten-second timeout and cancellation. It handles logout's empty 204 without JSON parsing. Only `/me` 401 establishes signed-out state; network failures and 5xx do not become wrong-password errors.

`authController.ts` owns explicit checking, signed-out, signed-in, submitting, signing-out, unavailable and failed-logout states. It deduplicates mutations and `/me` checks, invalidates stale results using request generations, and creates immutable verified identity/epoch leases. Uncertain signup/login outcomes reconcile with `/me`; they never automatically repeat a mutation. Cancellation leaves an uncertain locked state until another explicit check. The server may still finish an aborted request; local cancellation cannot undo it.

`AuthBoundary.tsx` creates a personal repository only after a verified response. Initial boot has no personal History instance, private DOM, camera or microphone. Visibility, pageshow, window focus and account-change hints trigger revalidation without polling. Pagehide hides private content synchronously for bfcache restoration. BroadcastChannel/storage messages contain only a random event nonce and changing/changed hint; they never establish identity or transmit records. The existing dashboard does not emit these hints, so a cookie change made there is discovered at the next foreground/pageshow/focus check. No frontend can detect every external cookie replacement instantaneously.

`AuthScreen.tsx` and `authCopy.ts` provide password-manager-compatible login/signup, show/hide, field validation, pending/cancel/error/retry/success states, EN/AR and RTL. No anonymous assistant bypass is present. The retained development History preview uses only synthetic in-memory data and cannot open personal stores or media. It is absent from production.

Logout Cancel is inert. Confirm locks authority synchronously, clears transient UI, retires the repository, cancels snapshot association and calls the existing public media cleanup before the HTTP request. A failed/uncertain logout stays locked with stopped media until 204 or `/me` 401 confirms it. It never deletes another account's records or uses `localStorage.clear()`.

On ordinary same-user revalidation the controller/stream identity remains stable; microphone/speech pause and video tracks are disabled during the check. Resume remains explicit. A starting or in-flight question is stopped to invalidate callbacks through the existing public controller generation. A subsequent explicit Start creates the normal new assistant session. Actual identity loss fully stops media and unmounts private views. App owner/epoch checks reject old answers and frame completions. History navigation, language renders and successful same-user `/me` checks do not create another controller or stream UUID.

`Modal.tsx` additionally traps Tab/Shift+Tab at the dialog boundary. This prevents keyboard focus escaping to browser chrome and causing a foreground check to interrupt a dialog. Native dialog Escape and focus return remain intact.

## Local History and legacy data

Personal IndexedDB database names and localStorage text-mirror keys use:

`echosight-history-account-v1:<encoded auth source>:<encoded verified user_id>`

The current explicit source/environment is `member2-sqlite-mobile-dev-v1` (`AUTH_SOURCE`). Each IndexedDB database has a `history` store with the `current` atomic records/Blobs snapshot. Every repository freezes its owner and captures its own namespace; hydration, revision, write queue, expiry and mutations never read a mutable current-user global. Retired and replacement instances of the same owner serialize outstanding writes within the tab. Disposed instances clear listeners and snapshots and cannot accept late mutations or repopulate the view. Already queued writes may finish only for their original owner. Dialogs, temporary object URLs and Undo buffers disappear on lock/unmount.

The previous anonymous data remains unclaimed at localStorage keys `echosight-local-history-v1` and `echosight-local-history-v2`, and IndexedDB database `echosight-history`, store `history`, key `current`. Authenticated repositories neither read nor mirror into those locations. No ownership was guessed and no migration, automatic import, guest purge or claim button was added. The legacy adapter remains for existing tests and the isolated in-memory preview, not the authenticated app path.

The existing limits remain: 50 records, 1.5 MB per photo, 20 MB total photos, and 24-hour expiry for new records. Text-only fallback and newer text revisions prevent stale DB hydration from resurrecting failed deletes/clears. Browser shutdown/suspension can delay physical expiry. Search, details, copy/share, delete/Undo and Clear all use the active account's repository. Demo and question-time snapshot labels remain.

This is **local test History on this browser/origin**, not encrypted multi-user server storage or cross-device synchronization. A browser-profile owner can inspect all local records. Changing hostname/origin, clearing storage or changing devices does not preserve or synchronize them. A returns to A's own surviving records on the same origin; B has a separate store. Parallel editing of one account in multiple tabs is not a collaborative merge protocol; avoid concurrent editing of the same account. Independent simultaneous logins require different isolated browser profiles because cookies are shared across tabs.

If the authoritative account database/environment changes, coordinate a new `AUTH_SOURCE` value and explicit migration/recreation policy. Never map old data to a new user by email. Test accounts may need recreation; neither account nor History migration is promised.

## Development runtime

Use an isolated virtual environment and a dedicated database outside Git. Never use the teammate's default `web/ai-backend/data/users.sqlite3`. From a PowerShell terminal, initial environment setup can use:

```powershell
$authRuntime = Join-Path $env:LOCALAPPDATA 'EchoSight\mobile-auth-dev'
python -m venv (Join-Path $authRuntime 'venv')
& (Join-Path $authRuntime 'venv\Scripts\python.exe') -m pip install -r 'C:\Users\user\Aether\web\ai-backend\requirements.txt'
```

The task already installed the unchanged requirements in the external temporary venv listed in the runtime record below; it can be reused without global installation. For ordinary local HTTP development, start the unchanged service in its own terminal:

```powershell
$authRuntime = Join-Path $env:LOCALAPPDATA 'EchoSight\mobile-auth-dev'
$env:AUTH_DB_PATH = Join-Path $authRuntime 'users.sqlite3'
$env:AUTH_COOKIE_SECURE = 'false' # explicit local HTTP setting only
$env:PYTHONDONTWRITEBYTECODE = '1'
& (Join-Path $authRuntime 'venv\Scripts\python.exe') -B -m uvicorn app.main:app --app-dir 'C:\Users\user\Aether\web\ai-backend' --host 127.0.0.1 --port 8002 --no-access-log
```

Keep this development DB between runs. Never reset it as part of tests. Verify that 8002 is free or belongs to this exact instance; otherwise use another free loopback port. Do not stop another service. In a second terminal:

```powershell
Set-Location 'C:\Users\user\Aether\mobile\frontend'
$env:AUTH_PROXY_TARGET = 'http://127.0.0.1:8002'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The server-only `AUTH_PROXY_TARGET` is read from the Vite process environment, not exposed as `VITE_*`. It defaults to `http://127.0.0.1:8002` and rejects non-loopback targets, credentials, paths and invalid ports. Only `/api/v1/auth` is proxied, with no Set-Cookie rewriting. Voice/AI/media endpoints and the specific existing host allowlist remain unchanged. The proxy adds `Cache-Control: no-store` to auth responses for dev and preview. No wildcard hosts/CORS were added.

The existing generated worker caches static assets only; its source/configuration was not changed. Auth fetches are not runtime-cached. Production preview was tested with an active worker and offline `/me` did not yield cached identity. Vite is a development/preview transport, **not a production reverse proxy**. A deployed HTTPS backend/reverse proxy must preserve cookies and set no-store cache policy independently. See [Vite server proxy](https://vite.dev/config/server-options#server-proxy) and [preview proxy](https://vite.dev/config/preview-options#preview-proxy).

For a future authorized HTTPS phone test, set `AUTH_COOKIE_SECURE=true` on the auth service, keep it bound to loopback, and serve `/api/v1/auth` behind the same PWA HTTPS origin. Verify cookie creation, `/me` and deletion through that origin. Do not expose port 8002 independently. No public tunnel or HTTPS phone session was launched in this task, and the old hostname in the allowlist is not a claim that a tunnel is running.

## Validation

Commands from `mobile/frontend/`:

```powershell
npm.cmd run build
npm.cmd run lint
node --experimental-strip-types --test validation/history.test.mjs validation/auth.test.mjs
node validation/browser-check.mjs
$env:AUTH_LIVE = '1'
node validation/auth-browser-check.mjs
```

For live tests, start the unchanged backend with `AUTH_DB_PATH` pointing to a **separate disposable** SQLite file outside Git, and use the same-origin dev proxy above. The browser test creates random `.test` accounts and ephemeral credentials, never real accounts. `AUTH_LIVE` belongs only to the test process; it is not a product auth bypass. Default auth tests use deterministic HTTP mocks. `PLAYWRIGHT_PATH` and `CHROME_PATH` can select existing test installations; no new frontend packages were required.

For the production worker/proxy check, run `npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort` against the disposable backend and then `node validation/auth-proxy-check.mjs`. This checks signup 201, duplicate 409, `/me` 200, logout 204, `/me` 401, no-store, cookie invisibility to script, cache contents and offline failure. Do not run account-creating tests against an ordinary development or teammate DB.

Results during this task:

- TypeScript/Vite/PWA production build and lint passed with no lint warnings.
- 26 Node tests passed: 10 existing History/snapshot tests and 16 new auth/account-store tests.
- Existing Chromium Home/History matrix passed: 152 entries; targeted keyboard/interaction run passed: 24 entries.
- Auth browser suite passed: unknown-identity gating, recoverable outage, wrong-password/rate-limit messages, EN/AR/RTL validation, focus, 360px 200% text, reduced motion and 48px controls; A/B images, search, copy/share, Undo, reload, Clear, legacy preservation, late A callback, stopped media, failed-logout retry, pageshow and cross-tab logout.
- Real local SQLite integration passed through the same-origin proxy for two accounts: signup, HttpOnly/Lax cookie, `/me`, cookie deletion, 401, and login again. No camera permissions on signup/login. SQLite file header and synthetic-only rows were checked read-only; passwords were scrypt hashes. No MySQL was involved.
- Production-preview proxy/service-worker test passed. Production output excludes development fixtures.

Screenshots, result JSON, profiles, audit snapshots, logs and SQLite files stay outside Git. The original 163 untracked validation artifacts are preserved. Desktop Chromium/emulated media and synthetic frames do not validate actual camera, microphone, WHIP, STT/TTS, Safari, iPhone, VoiceOver, Dynamic Type or hardware safe areas. HTTP cookie checks do not prove the future HTTPS/phone configuration. Those remain physical-device acceptance work.

## Runtime record and safe cleanup

Task evidence/venv root: `C:\Users\user\AppData\Local\Temp\echosight-auth-ee20e3a7775f4da7a3d195adac01f76b`.

- `initial-audit.json`, `implementation-baseline.json`, `final-audit.json`: Git status and protected-file hashes (no private env contents).
- `venv\Scripts\python.exe`: isolated backend interpreter; unchanged requirements installed here.
- `integration.sqlite3`: disposable automated-test database; not the ordinary development account store.
- Auth screenshots/results: latest run `C:\Users\user\AppData\Local\Temp\echosight-auth-browser-LEMOWZ`.
- Existing matrix output: `C:\Users\user\AppData\Local\Temp\echosight-history-check-rey02w`; targeted output: `C:\Users\user\AppData\Local\Temp\echosight-history-check-as3p7N`.

The companion `runtime.json` in the evidence root records the final processes/ports and log locations. Stop only the task's recorded terminal sessions/processes after checking their command line and start time. Never kill all Python/Node processes or remove another worktree. The isolated merge worktree is retained; no Git cleanup was attempted after the auth branch transition. Preserve the dedicated development account DB between ordinary runs.

At handoff, the frontend is running at `http://127.0.0.1:5173` (Node PID 12496) and the unchanged development backend at `127.0.0.1:8002` (Python PID 23020). The backend uses `C:\Users\user\AppData\Local\EchoSight\mobile-auth-dev\users.sqlite3`, which was absent before this task, and the temporary venv above. No automated test accounts were added to this development DB. A same-origin smoke check returned 401 with `Cache-Control: no-store`, as expected for a fresh signed-out client. The disposable test backend, merge-check Vite process and production preview were stopped. There is no public tunnel.

Backend startup output is in `backend-dev.log`; frontend output is in the task's terminal session. The evidence root includes `stop-task-runtime.ps1`, which checks each recorded PID's name and exact start time before stopping it, and leaves reused PIDs alone. It does not delete databases, files or worktrees. These process IDs are a handoff snapshot, not permanent identifiers.

The final scope audit lists 18 auth source/documentation/test paths inside `mobile/frontend/` (nine modified files and nine new files), verifies 297 protected files by SHA-256, and preserves all 163 pre-existing untracked validation artifacts. It also verifies the original MediaMTX and dashboard-lockfile modifications, zero staged paths and the unchanged auth-branch HEAD.

## Security and team handoff

This feature gates the mobile UI and segregates its local stores. It does not authorize MediaMTX publishing/read endpoints, secure the browser profile, or provide server History authorization. Use only synthetic/test personal data until shared-system protections are integrated. The unchanged backend has no explicit CSRF token/origin validation, has per-process/per-email login throttling, and retains a seven-day session policy; CSRF, abuse limits, session rotation/revocation, authorized API/evidence access and deployed cookie/cache settings need Member 2/team review. SameSite cookies and frontend hiding are not a complete authorization system; see [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

Keep `AuthClient` as the existing-API boundary and `HistoryStorage` as the future repository adapter boundary. A future server adapter requires real agreed endpoints; none were invented here. Team decisions still needed:

1. Authoritative account store/MySQL migration, stable user IDs and explicit test-account/data migration or recreation.
2. Server creation/ending of assistant sessions linked to the authenticated account, and authorized all-session question listing/pagination.
3. Authorized Member 3 evidence images; reconciliation of local IDs/photos with server `question_id` and `evidence_frame_ids`.
4. Account-safe delete/retention, stream permissions, HTTPS deployment, CSRF/session protections and cache policy.

The server must derive user identity from its authenticated session and enforce ownership for each endpoint. A client-supplied `user_id` is never server authorization. Shared API contracts were not edited. This is more than replacing one URL.

The known English automatic playback limitation remains. The existing conservative photo-after-pause behavior remains: after pause, records may be text-only until an already-supported safe generation boundary/new Start. No voice engine, codec, resolution, stream path or payload was changed.

## Next physical phone test

With a separately authorized, correctly configured HTTPS origin: login as A → explicit Start → ask/History → logout while active → confirm camera/mic/speech stop → login B → verify no A records → logout/login A on the same origin → verify A's surviving records return. Check genuine cookie creation/deletion, network failure during logout, EN/AR, VoiceOver, large text, keyboard/safe areas, background/Back restoration and conservative photo association. No physical-device success is claimed here.
