# Aether native experiment

**LOCAL IMPLEMENTATION COMPLETE; NATIVE BUILD/DEVICE VERIFICATION PENDING.** This is a separate Expo/React Native experiment based on the current local Option B · Mono PWA. The accepted PWA remains intact. No old Expo implementation is reused.

The eight screen families, EN/AR dictionaries, light/dark Mono appearance, actual SQLite account authentication, owner-bound local History, session lifecycle, native camera/recognition/WebRTC adapters, deterministic demo answers, device TTS, and Replay are implemented. Native pixels, permissions, cookie persistence, audio and video have not been observed on a phone. See [PARITY.md](PARITY.md) for each feature and every known gap.

Start with [INSTALL.md](INSTALL.md). [VALIDATION.md](VALIDATION.md) distinguishes passing software checks from native/device work. [COMPATIBILITY.md](COMPATIBILITY.md) records versions, official evidence, Expo Doctor's remaining WebRTC warning and dependency advisories. [INVENTORY.md](INVENTORY.md) maps files and provenance.

## Two runtimes, one app

| Runtime | Available implementation | Unavailable or unverified |
| --- | --- | --- |
| Expo Go SDK 58 preview | Same native screens, fixture auth, local History, Expo camera, device TTS/Replay; explicitly labeled development typed-question test | No WebRTC or OS recognition module; no publishing. Phone startup, native cookies, camera, TTS and snapshots still need device verification. |
| Custom development build | Adds rear WebRTC capture/RTCView, video-only WHIP and OS speech recognition | No compiled APK/IPA exists here. WebRTC/New Architecture compatibility and every physical acceptance item remain unverified. Native WebRTC has no supported question-time snapshot API in the inspected version, so History keeps text with No photo saved. |

Only visual answers are simulated. Successful login requires a verified response from the isolated SQLite service. Recognition requires real OS events. Streaming status requires the peer's actual connection state; registration and HTTP success do not prove moving video. No AI or Phase 3 request is made. OS recognition can use the device vendor's online service; no application speech API credentials or model downloads are used.

## Ownership and storage

`dev-server/server.mjs` is a development-only compatibility fixture. Its persistent file is `.runtime/accounts.sqlite3`; tests create separate disposable databases. Passwords use scrypt; unpredictable cookie tokens are stored as SHA-256 hashes, expire, and are revoked on logout. Cookies are HttpOnly, SameSite=Lax and unique to the fixture environment. The CLI uses private-development HTTP and omits Secure accordingly; the exported fixture factory defaults to Secure cookies for a trusted HTTPS host/proxy. There is no certificate bypass or built-in public deployment.

The app requires the fixture's `/health` SQLite/demo marker before authenticating. Accounts here are separate from PWA/production accounts. This fixture does **not** implement production MySQL/JWT refresh, connect to MySQL/PostgreSQL, or make the teammate dashboard recognize these accounts. Stream start/stop request paths and `{session_id}` follow the supplied existing contract. The newer production response implementation was absent locally, so exact production response parity remains unverified.

Private metadata uses AsyncStorage and relative app-private JPEG paths, keyed by backend origin + persistent fixture environment UUID + verified user UUID. Passwords/tokens are never stored there. Media and UI authority stop on logout, auth lock, background, unmount or endpoint change. Endpoint changes require fresh authentication in the active app. Native cookie persistence/revocation across relaunch remains a device acceptance item.

History retains at most 50 timestamped entries for 24 hours, 1,500,000 bytes per photo and 20,000,000 aggregate photo bytes. Text survives unsupported/failed snapshots. Expiry runs during verified-account hydration, resume and every 30 seconds while mounted. Physical deletion can be delayed by suspension, filesystem errors, or an account remaining signed out. One deleted item can be undone until dismissal/replacement/expiry/Clear; its photo remains leased. No bulk Undo, browser migration, cross-device sync or application-level encryption is claimed. Android backup is disabled; device/container backup behavior on iOS remains a platform verification item.

## Local scope

All new source, packages, lockfile, generated Android project, bundles, fixture data, tests and docs are in this folder. No Git write, remote ref operation, source upload, workflow, deployment, shared backend/database initialization, or protected source edit was performed. The audit compares 4,303 protected files and branch/HEAD/index/staged/dirty state; details and exclusions are in VALIDATION.md.
