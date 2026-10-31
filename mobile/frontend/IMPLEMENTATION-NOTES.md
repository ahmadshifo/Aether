# EchoSight Phase 1 frontend handoff

Implemented locally on 2026-10-31. This is a reviewable frontend implementation, not a declaration that Phase 1 or the whole project has completed real-device acceptance. Phase 3 remains deferred.

## Design and files

The existing navy/teal tokens and font stack are retained. Home uses a bounded camera stage, real controller states, a collapsible answer, and persistent errors above the stage. The floating three-action dock remains centered across Home and History, mirrors in Arabic, and includes a strictly demo sign-out sheet. The camera element remains mounted when Home is hidden. Streaming success/failure has separate presentation state so a voice error reset cannot falsely mark failed publishing Live.

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Persistent shell, dock, state presentation, mock sign-out, narrow history/capture callbacks |
| `src/index.css`, `src/EchoIcon.tsx` | Theme, layout, SVG icons, RTL, reduced motion, scalable text, focus styles |
| `src/HistoryPage.tsx` | Search, calendar groups, cards, details/zoom, copy/share, delete/undo, Clear all |
| `src/Modal.tsx` | Native modal dialogs, background inertness, Escape, focus return |
| `src/uiCopy.ts` | New English and Arabic copy |
| `src/historyRepository.ts`, `src/useHistory.ts` | Typed local repository, hydration, persistence, retention scheduling |
| `src/snapshotBridge.ts` | Bounded question-time Blob association |
| `src/historyFixtures.ts`, `src/HistoryPreview.tsx` | Eight explicitly labeled development samples; in-memory preview |
| `index.html` | Added only `viewport-fit=cover`; browser zoom remains enabled |
| `validation/history.test.mjs`, `validation/browser-check.mjs` | Maintained repository and browser validation source |

No package or lockfile dependency changes were needed. Existing unused legacy UI files were left alone.

## Local-history behavior and integration points

`LocalHistoryRepository` exposes `list/upsert/remove/restore/clear`. Its `HistoryStorage` interface is the future server-adapter boundary; no backend calls or contract changes were introduced. Future integration must use the agreed question/history contracts and explicitly reconcile server IDs/evidence rather than presenting this local snapshot as backend evidence.

IndexedDB stores an atomic snapshot containing records and image Blobs. Removing/expiring a record cannot leave a separately stored orphan image. Limits are 50 entries, 1.5 MB per image and 20 MB of persisted images. Oversize images fall back to text. Temporary object URLs are revoked on replacement/unmount. A versioned text-only localStorage mirror, plus the original `echosight-local-history-v1` bridge, protects legacy text and supports storage failure fallback. No base64 photos or blob URLs are persisted. A newer text revision takes precedence over stale IndexedDB after a failed deletion/clear write. Pending hydration replays local changes instead of overwriting new answers. Writes are deferred out of the synchronous answer callback, and failures do not fail speech.

Undo retains one removed record, its Blob and neighboring order anchors in memory. It does not have an ordinary timeout, so hovering/focusing it cannot cause expiry. Dismissal, another deletion, Clear all, reload, or the existing retention deadline finalizes that opportunity. It also preserves order if a new answer arrives before Undo.

Storage is browser- and origin-specific. A different trycloudflare hostname, browser profile or device has a different store. Local snapshots are not uploaded by this feature. Share defaults to text without a URL; sharing with a photo requires its separate explicit action. Demo answers and sample illustrations are labeled.

`App.getFrame → SnapshotBridge.capture` reuses the exact Blob returned by the original, unchanged `captureFrame` algorithm. `onAnswer → consume` checks question text, language, app generation and streaming session ID; it consumes a snapshot once. Normal `VoiceSession.handleQuestion` stops input before capture and emits its answer before speech/return-to-listening, giving one normal in-flight question. Stop, unmount, language change, errors and visibility transitions invalidate pending associations.

`pause()` does not advance the protected controller generation. A late `toBlob` can therefore outlive pause. After History/background pause, the bridge conservatively stores text without photos until a new Start or a safe language generation on Home. It never recaptures after an answer. This limitation requires a separately authorized controller correlation/cancellation extension to remove.

The future real-login callback location is marked in the sign-out confirmation handler in `App.tsx`. Today that handler only dismisses the sheet and displays “Signed out (demo)”: no auth, session, storage or navigation action.

## Existing policy conflict and deferred controls

`docs/safety-and-privacy.md` says: “Delete stored frames, metadata and question history within 24 hours.” New records expire after 24 hours, during active timers or hydration/foreground cleanup. Browser code cannot guarantee physical deletion while the browser is closed or suspended. The brief also requires preserving legacy history, whose localized dates cannot be interpreted safely. Those records retain their original labels under Earlier and remain until explicit deletion or the existing 50-item cap. Automatic legacy expiry and guaranteed background deletion are deferred for policy/integration review; no exact date was invented and no new silent legacy purge was applied.

The protected controller has no public speech-only Stop or true playback Pause/Resume. These controls are omitted, with an explanation in details. Full session Stop remains the real existing Stop.

History Replay uses only the public controller when idle, in the matching interface language, and without a configured voice service. Active replay would resume recognition despite the History pause. Replay cannot choose a separate language. Additionally, configured service synthesis returns before playback when the controller is inactive. Those cases show an unavailable explanation instead of changing recognition language, starting a session, calling private methods or creating another TTS engine. Home latest-answer Replay remains connected to the public controller. Provider integration, browser autoplay and voice quality remain deferred. The known English automatic speech playback limitation is unresolved and deferred to Phase 3; this frontend redesign does not claim to fix it.

## Validation actually run

| Check | Result |
| --- | --- |
| `npm.cmd run build` | Passed: TypeScript + Vite + existing PWA build |
| `npm.cmd run lint` | Passed, no warnings |
| `node --experimental-strip-types --test validation/history.test.mjs` | 10 tests passed |
| `node validation/browser-check.mjs` | Chromium matrix and interactions passed; 152 result entries (150 screenshots and two interaction groups), no failures |
| `$env:EDGES_ONLY='1'; node validation/browser-check.mjs` | Final targeted interaction run passed after Undo order refinement; 24 result entries |
| Production bundle inspection | Development fixtures absent from emitted JavaScript |
| Initial/final boundary comparison | 127 baseline files checked; only five explicitly allowed existing frontend files changed |

The PowerShell `npm` shim is restricted by the machine policy; `npm.cmd` ran the same scripts successfully. Tests reuse the installed Playwright runtime and installed Chrome; no test dependencies were installed. `PLAYWRIGHT_PATH` and `CHROME_PATH` can override their paths in the browser runner. Run Vite on `127.0.0.1:5173` before browser checks.

The matrix covers 360×640, 390×844, 768×1024 and 1280×800 in EN/AR: idle, starting, listening/live, hearing, thinking, speaking, paused, streaming error, empty/populated/no-results History, long answer, details, zoom, sign-out and Clear all. Additional checks cover actual gated hydration, denied storage, voice-only and permission-error UI, Retry, delete/Undo and selected-record deletion, mixed-language replay guards, copy denial/success, share absence/cancellation and explicit photo sharing, modal focus containment/Escape/return, reload persistence, no Clear-all resurrection, 200% text, reduced motion, 48px Home controls, RTL swipe versus vertical gestures, and a 390×500 keyboard-sized viewport. Media controllers are substituted only in tests; all non-local requests are blocked. No real microphone, camera, AI, auth endpoint or private photo was used.

Local-only results: `validation/browser-results.json`, `validation/browser-edge-results.json`. Generated reports, baseline inventories, screenshots, contact sheets and the local contact-sheet helper are excluded from the feature commit. Full screenshots are in `validation/screenshots/`; eight visually reviewed matrix indexes are in `validation/contact-sheets/` (desktop indexes crop the centered app; originals retain the entire viewport). Representative local originals:

- `validation/screenshots/360x640-en-idle.png`
- `validation/screenshots/390x844-ar-history.png`
- `validation/screenshots/1280x800-en-detail.png`
- `validation/screenshots/edge-en-permission-error.png`
- `validation/screenshots/edge-ar-large-history.png`

Development-only preview: `http://127.0.0.1:5173/?preview=history`. It uses eight original SVG sample illustrations/records in memory, creates no media controller, and never seeds or replaces real History. Preview/sample files are not ignored by repository rules. Production removes this entry point and sample content.

## Boundaries and remaining physical-device review

At the end of the original local implementation, the branch was `main` and HEAD was `18f5cee89443cc0b66dd6fd7b392c198e39aa25d`. The local `validation/initial-baseline.json` records that original status, diff and hashes; `validation/final-boundaries.json` records comparison evidence. `voiceSession.ts`, `whipPublisher.ts`, network clients, configuration, PWA source files, shared contracts, voice service and all files outside `mobile/frontend/` matched their initial hashes. The user's existing `mobile/streaming/mediamtx.yml` and `web/dashboard/package-lock.json` changes remained byte-for-byte unchanged. The ignored `.env.local` was not in the initial Git inventory; it was never written, and its last-write time predates the implementation. No Git write or Git remote operation, deployment or PR action was performed during that implementation. The subsequent source audit and single frontend commit are scoped to `feature/mobile-pwa-redesign`; `main` is not a commit or merge target.

Physical iPhone testing remains required; desktop Chromium and viewport resizing are not Safari, VoiceOver, hardware safe-area or real-keyboard tests. Arabic text and RTL were reviewed in code/rendered layouts; native-speaker and VoiceOver review remain useful acceptance steps. No formal WCAG conformance is claimed from screenshot/hex inspection.

1. Start: confirm the existing camera + microphone permission flow, WHIP `live/{session_id}` identity, listening and speech behavior. Check failures remain truthful.
2. Ask distinct visual questions; compare snapshots with question-time views and verify Demo labels. Pause/navigation should never attach a stale photo; after pause expect text-only until the safe generation boundary above.
3. Home → History → details → Home: confirm no duplicate streams, hidden focus targets or unintended microphone restart. Exercise EN/AR, VoiceOver, Dynamic Type, keyboard, safe area, address-bar resizing and reduced motion.
4. Replay the latest answer, Stop, then Start again. Review the declared History playback limitations without enabling unsupported controls.
5. Reload on the same origin; check photos/text, delete/Undo/order, Clear-all cancel/confirm, explicit sharing and strictly inert demo sign-out.

Browser capability references consulted: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) for Blob storage and origin scope; [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) for explicit activation and optional file support. Haptics were omitted as an optional enhancement.
