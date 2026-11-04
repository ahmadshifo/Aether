# Validation report — 2026-11-04

**LOCAL IMPLEMENTATION COMPLETE; NATIVE BUILD/DEVICE VERIFICATION PENDING.** Source and a running Expo Go development preview are prepared. This report does not certify complete physical parity or production readiness.

## Results and reproducible commands

Commands ran from `C:\Users\user\Aether\mobile\native` using Node22.20.0/npm11.6.1. Outputs are under ignored `validation/artifacts/`.

| Check | Exit/result | Evidence / limit |
| --- | --- | --- |
| `npm ls --depth=0` | 0 | `dependencies.txt`; complete app-local tree |
| `node scripts/expo.mjs install --check` | 0, up to date | `expo-dependencies.log` |
| `npm run typecheck` | 0 | `typecheck.log` |
| `npm run lint` | 0, no warnings | `lint.log`; oxlint app/tests/scripts/fixture |
| `npm test` | 0, **27 passing** | `state-fixture-tests.log`; pure state/protocol tests plus real isolated SQLite/HTTP |
| `npm run test:ui` | 0, **10 passing** | `component-tests.log`; Jest Expo native-component mocks, no native layout engine |
| `node scripts/expo.mjs config --type introspect --json` with opted-in LAN host | 0 | `expo-config-lan.json`; iOS permission/ATS and Android plugins resolve |
| `node scripts/expo.mjs prebuild --platform android --no-install` | 0 | `android-prebuild.log`; app-local generated project only, not Gradle compilation |
| `npx --yes expo-doctor@1.21.6` | **1; 19/20 checks pass** | `expo-doctor.log`; WebRTC untested New Architecture metadata remains visible |
| `npm run export` | 0, iOS + Android Hermes bundles | `metro-export.log`, `dist/metadata.json`; bundles are not an APK/IPA |
| `npm audit --json` | **1; 25 moderate + 1 low** | `npm-audit.json`; transitive tooling advisories remain after nonbreaking fix attempt |
| `node scripts/live-smoke.mjs` | 0 | `live-fixture-smoke.log`; actual running fixture signup201/me200/login200/logout204/revoked-me401; synthetic account removed |
| Live LAN HTTP / Expo manifest | Healthy from laptop | `live-services.json`; fixture marker, Metro running, SDK58 launch asset. Phone reachability not established |
| `node scripts/audit.mjs` | 0 | `final-boundaries.json`; 4,303 protected hashes and Git state unchanged |

Node22 prints experimental SQLite/type-transform warnings and a module-type reparse notice in pure TypeScript tests. No warning was disguised as device evidence. Initial module isolation disabled Metro's normal lookup and was corrected to Expo's default standalone config. Initial sandbox Hermes output was denied; the wrapper now uses app-local temporary/settings directories and the compiler was rerun successfully. Initial component tests revealed a stale form-validation message hiding an outage; the actual component was fixed. All final tests pass.

## Coverage

- EN/AR nested key parity, exact Mono tokens, 48-point controls, Go module gates, public setup with no account data, auth forms/outage, all eight screen families and protected confirmations.
- Mocked component route tests use 402×874 and 412×915 dimensions with 200% text. They exercise the large-text branch but do **not** compute or verify native layout pixels, small-phone clipping, keyboard avoidance or safe areas.
- Real disposable SQLite database: validation, duplicate accounts, invalid credentials/rate limit, scrypt/hash storage, cookie attributes, `/me`, revoke/logout, restart persistence, expiry, stream UUID/ownership, stale Stop/newer session isolation, stop-before-start tombstones, rejected foreign Origin and absent `/ask`.
- Auth cancellation/late callbacks, immediate authority lock, failed logout remaining locked, same-owner recheck and endpoint fresh-auth barrier. Native cookie behavior and relaunch consequences remain phone acceptance items; HTTP tests manually maintain a test cookie jar and are not native-cookie tests.
- Owner/environment A/B separation, queued hydration/write races, corruption without automatic overwrite on hydration, limits/path checks, normalized search/date groups, delete/Undo/order/photo lease, Clear invalidation, write errors and disposal.
- Twenty Start/Stop lifetimes, stop/logout during startup, recognition final vs interim/confidence, explicit Go typed labeling, real-camera-state distinction from photo support, old-generation frame/photo rejection, idle Arabic Replay, permission denial/background, early-final recognition shutdown before TTS, serialized permission cancellation.
- WHIP SDP/content type/Location validation, same-origin relative/absolute resources, ICE deadline/abort, failed HTTP/SDP, late POST DELETE, closed peer and transport loss. Optional codec API absence is safe; H.264 preference is tested without claiming device support.
- Mocked native TTS callbacks/language/cancellation; History copy/share dismissal/Stop speech/delete/Undo/Clear Cancel/confirm; hold release-inside and accessible normal confirmation.

## Runtime observations

Started 2026-11-04 at 12:47:42 UTC. Fixture PID **35536** listens on `0.0.0.0:18063`; Metro listener PID **10740**, wrapper **25244**, listens on port **8083**. Wi-Fi IPv4: **192.168.1.103**. Startup commands are `node dev-server/server.mjs --lan` and `node scripts/expo.mjs start --go --lan --port 8083`. Working directory is this app. Logs and process metadata stay under `.runtime/` and `validation/artifacts/`. Current availability must be checked again after laptop sleep/restart; these are observed PIDs, not promises of indefinite execution.

The live fixture smoke test uses random disposable credentials without logging them and deletes only its exact synthetic account after logout. Ordinary fixture data persists in `.runtime/accounts.sqlite3`. Test databases are separate random files and cleaned individually. No shared database connection or shared backend import occurred. MediaMTX was not running and was not started because Go cannot publish WebRTC; there is no streaming success claim.

## Native/visual evidence that does not exist yet

- No Android compilation, APK installation, iOS compilation/signing/IPA, native simulator or physical-device run.
- No real microphone transcript, audible first TTS/Replay, native cookie persistence/revocation, rear-camera photo, H.264 negotiation or moving phone-to-laptop stream.
- No app screenshots. Launcher icon PNG was inspected only as a brand asset. No browser screenshot is presented as native evidence. All eight screens' native EN/AR/long text/keyboard/safe area/reduced motion/small phone/target-size visual reviews remain pending.
- No VoiceOver/TalkBack certification or physical focus/gesture verification.
- Full WebRTC photo parity is specifically unavailable: the inspected track has no supported same-camera frame API. Text records and No photo saved remain functional; no second camera/fake image is used.

Full iPhone native installation blocked: build/signing route not yet available under current permissions. Android SDK/adb/emulator were not found; Java23 alone is insufficient. No installer, paid membership, Apple credentials, signing change, firewall rule or public tunnel was used. See [COMPATIBILITY.md](COMPATIBILITY.md), [PARITY.md](PARITY.md), and [device checklist](validation/DEVICE-CHECKLIST.md).

## Protected-boundary proof

Baseline was recorded **before implementation** in `validation/artifacts/baseline.json`. `scripts/audit.mjs` recursively hashes protected files and compares the original status/staging/branch/HEAD/index to the final state. Final result: **4,303 protected files, zero changed/added/deleted protected paths, Git state unchanged**. All newly introduced project paths are under `mobile/native/`.

Branch remains `feature/mobile-auth-mono-backup`; HEAD remains `bb54dbd94bd30c9842bd3c34cb8afd57eb31c88a`. Staging remains empty and the Git index SHA-256 is identical. Pre-existing modifications to `mobile/streaming/mediamtx.yml` and `web/dashboard/package-lock.json`, and existing untracked frontend validation work, are preserved. PWA, old Expo, streaming, voice-service, web, multimedia, shared, docs, root and `.github` source/config/data inventories match the baseline.

Audit scope is explicit: dependency/generated/cache directories named `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.npm-cache`, `.expo`, `bin`, `obj`, and symbolic links are excluded from recursive file hashing. The Git index is separately hashed. This is not a claim to have hashed every external tool cache. Configurable new caches/outputs are app-local; no protected source/config files were used as temporary outputs. Baseline/artifact files contain hashes/paths and synthetic diagnostics, not printed secret configuration values.

No Git write command, remote-ref operation, fetch/pull, branch switch, commit, source upload, workflow creation/run, deployment or publication occurred. npm/official documentation/font downloads were read operations; generated native projects and dependencies are local. All work remains uncommitted as requested.
