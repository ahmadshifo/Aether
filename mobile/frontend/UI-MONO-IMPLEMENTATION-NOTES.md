# Aether Option B · Mono — local implementation

Implemented on 2026-11-02 in the existing React/TypeScript/Vite PWA. Real signup, login, logout, session enforcement and account-scoped local History remain the existing implementation. No authentication or media behavior was replaced with a demo.

## References and scope

Read all 598 lines of `C:\Users\user\Downloads\Aether_Codex_Mono_UI_Only_Preserve_Auth.txt`, including the original handoff and its accessibility/scope refinements. The [owner-only canvas](https://claude.ai/artifact/Tqz67zYTED5cHBAwBKaswV) was inaccessible; visual matching used the written specification, not an unseen canvas. The [Kitchen component reference](https://www.dqnamo.com/kitchen) and [W3C pointer-cancellation explanation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html) were accessible. No project source was sent to a design service.

Read local `README.md` ownership guidance, `docs/architecture.md` (Architecture v1.0), `shared/contracts/api-v1.yaml`, `shared/contracts/media-v1.yaml`, and both existing frontend implementation/auth notes. No separate Team Agreement file was found. These files were not edited.

The original dirty checkout was preserved on `feature/mobile-auth-local`, HEAD `8280f1db11d77d993de61a8a380dcb1d9adf8687`. In particular, the earlier authentication work, `mobile/streaming/mediamtx.yml`, `web/dashboard/package-lock.json`, and pre-existing validation artifacts were not reverted or replaced.

## Implementation and requirement matrix

| Screen / requirement | Implemented behavior |
| --- | --- |
| Auth landing and forms | Square two-eye mark, Latin wordmark, tactile Log in, Sign up, existing name/email/password/confirmation forms, password visibility, validation, pending, cancel, outage and locked states. Only successful real auth enters the private UI. |
| Welcome | Account/environment-scoped display preference, 130px mark, explanation, two permission cards, Get started to Home, safety and accurate retention copy. No capture on mount or completion. |
| Home | Greeting, truthful Connection link, 92px mark card and Start, five source questions, selectable fan and readable question panel, current-account History preview only. |
| Assistant | Persistent video/ref and owner, two sibling idle Start buttons, real starting/listening/hearing/processing/speaking/paused/error rendering, opaque camera/voice status labels, transcript, full answer receipt and cassette Replay. No tab bar or History button. Active Back confirms Stop and Home; Cancel keeps the session. |
| History | Clean question rows with inline expansion, original-language text, date/language metadata, existing search/groups/details/photos/zoom/copy/share/delete/persistent Undo and confirmed Clear all. No fabricated uncertainty or evidence. |
| Settings | Explicitly unavailable voice controls, browser-optional haptics, display-only motion preference, Hold to clear plus Clear options dialog, Connection/Help links, verified identity and real Sign out. Settings Clear resets the History view's transient Undo/selection so cleared records cannot be restored by a stale UI buffer. |
| Help | Four numbered instructions, perforated question stamps including Arabic, natural-pause guidance without an unconditional silence timer, both stop methods and cane/guide-dog/no-safety-guarantee copy. |
| Connection | Individual observed statuses, optional exact-ID copy with real clipboard success/fallback, perforated ticket and local-state Check. The most recent explicit Start ID is retained only in account-scoped presentation memory after Stop and labeled stopped; reload does not invent a session. |
| Navigation | Home · History · Assistant · Help · Settings; Connection uses its parent as the single current destination. Native navigation landmark and `aria-current`, mirrored in Arabic. No route effect starts capture. |
| Visual system | Exact named Mono tokens, solid fills, modular active CSS replacing the old navy/teal stylesheet, SVG mark, requested Google Fonts links with `display=swap` and system fallbacks. No dependency changes. |
| Accessibility | Native controls, existing focus-trapped dialogs, readable essential text, at least 44px targets (most 48px), 92px Assistant actions, safe areas, zoom/reflow, EN/AR, RTL, reduced motion and forced colors. |

Reusable UI includes Brand/Mark, TactileButton, measured DynamicButton, HoldToConfirm, LogoTraceLoader, bounded ScrambleText, receipt/cassette presentation, Playing Cards, stamp/ticket/selector and five-column navigation. They are all used. The optional ScrollFadeList mask was omitted so text and focus rings stay unobscured.

Tactile faces compress in 80ms; dynamic labels resize in 300ms; trace drawing takes 800ms with 150ms eye completion; paper reveals over 900ms using its actual, unrestricted content height. English scramble ticks at 40ms, settles interim transcripts first, finishes within approximately 640ms, and exposes only canonical text to assistive technology. Arabic uses stable shaped text. Decorative overlays are removed after completion so text selection remains visible. Reduced motion/display preference disables decoration without disabling the hold threshold. Reels remain stationary because actual playback state is not exposed.

At narrow widths or enlarged text, cards become non-overlapping horizontally scrollable buttons with ordinary keyboard access. At intermediate widths the fan uses less rotation/spread; full source geometry is used where it fits. The header and navigation labels wrap rather than shrinking enlarged text. Page headings receive programmatic focus; keyboard outlines remain visible.

## Deliberate refinements and deferred capabilities

- Permission cards say **Set up when you Start / Requested when you start**. There is no public permission-only operation, so they navigate to Home. No second `getUserMedia`, persisted permission flag or artificial Allowed state was added.
- Quick-question selection changes presentation only. **Start and ask this question** calls the existing Start once and displays a prompt to ask aloud. Automatic submission is deferred; there is no public ask method.
- A pointer hold arms after 1000ms of real elapsed time and commits once on release inside. Early release, leaving, cancellation, lost capture, Escape, blur, visibility change and unmount cancel. A quick activation opens a non-timed dialog; explicit Stop options / Clear options are always discoverable. Automatic auth/privacy/media cleanup still uses the original immediate Stop path.
- Single-record Undo remains persistent, subject only to the existing retention deadline. Bulk Undo is not supported; Clear all is confirmed and clearly described as irreversible.
- Cassette Replay uses the current public callback and existing language/provider/session guards. MP3 source, playback pause, duration and progress are not public, so no timeline, fake pause, new audio owner or additional synthesis request was added. No claim is made that the known English automatic-playback limitation is fixed.
- Speaking speed and read-aloud controls cannot be changed through the public controller. They are unavailable with explanations. Automatic hazard warnings are not implemented. Haptics are optional and cannot be guaranteed, particularly on iPhone PWA.
- Startup synthesis is deferred; current state is communicated visually and through concise live status. No competing speech engine was added.
- Current answer/history view data omit `uncertain` and evidence IDs. The receipt says **Evidence not provided**; no “SURE”, invented uncertainty or evidence count is inferred from a local snapshot. Demo answers remain explicitly labeled as not camera analysis.
- Check re-renders observable local state, not remote diagnostics. Configuration, a cookie or network availability is not represented as remote service health. No new endpoint, port exposure or polling was introduced. The controller does not expose an authoritative start timestamp.
- Retention remains the original local policy: new records expire after 24 hours, but suspension can delay deletion and ambiguous legacy dates are preserved. Photo association after pause retains its conservative text-only limitation.
- Protected manifest/PWA configuration still uses the **EchoSight** installed name and dark install metadata; the existing favicon and development-only sample preview were not rebranded. The document title and in-app UI are Aether.
- Google Fonts requests could not connect from the execution environment. The actual links are present, but screenshots intentionally test fallback fonts. Loaded Inter/Pirata One/Noto Sans Arabic appearance must still be checked on a connected device; no loaded-font visual match is claimed.

## Exact changes relative to the task-start working tree

All paths below are relative to `mobile/frontend/`.

Modified existing files:

- `index.html` — title, light visual theme metadata and Google Fonts links; boot/viewport/zoom preserved.
- `src/App.tsx` — presentation composition and public callbacks into MonoShell; persistent owner retained.
- `src/AuthScreen.tsx` — landing/form presentation; original submission callback retained exactly.
- `src/authCopy.ts` — visible welcome branding in EN/AR only.
- `src/EchoIcon.tsx` — Home and Settings icons.
- `src/HistoryPage.tsx` — inline question expansion, relocated thumbnails and share display title.
- `src/uiCopy.ts` — accurate retention and Assistant replay-location labels.
- `src/index.css` — replaces legacy active styles with modular imports.
- `validation/browser-check.mjs` — migrates visual/navigation expectations while retaining storage, media, replay, cleanup and other regression assertions.
- `validation/auth-browser-check.mjs` — new landing/navigation paths and added logout-during-capture regression; real auth and account-isolation checks retained.

New files:

- `src/components/ui/Brand.tsx`
- `src/components/ui/Buttons.tsx`
- `src/components/ui/MonoShell.tsx`
- `src/components/ui/monoCopy.ts`
- `src/styles/tokens.css`
- `src/styles/base.css`
- `src/styles/screens.css`
- `src/styles/responsive.css`
- `validation/mono-browser-check.mjs`
- `validation/mono-scope-check.mjs`
- `UI-MONO-IMPLEMENTATION-NOTES.md`

AuthScreen, authCopy and the auth browser runner were already untracked before this task; they are not newly created authentication work. The task-start changes in `.env.example`, `AuthBoundary.tsx`, `authClient.ts`, `authController.ts`, `Modal.tsx`, `historyRepository.ts`, `useHistory.ts`, `vite.config.ts`, original auth tests/notes, teammate files and existing artifacts remain unchanged. Other pre-existing App/CSS/copy changes were preserved as the starting implementation and redesigned only within the authorized presentation scope.

## Validation and evidence

Baseline: build, lint, all 26 Node tests, auth browser checks and 152 existing browser result entries passed before source edits. The first browser invocation found no running Vite server; it was rerun successfully after starting an isolated loopback development process. No pre-existing code failure was found.

Final commands from `mobile/frontend/`:

| Command | Result |
| --- | --- |
| `npm.cmd run build` | Passed: TypeScript, Vite and existing PWA generation |
| `npm.cmd run lint` | Passed without warnings |
| `node --experimental-strip-types --test validation/history.test.mjs validation/auth.test.mjs` | 26/26 passed |
| `node validation/browser-check.mjs` | 152 entries, zero failures |
| `$env:EDGES_ONLY='1'; node validation/browser-check.mjs` | 24 entries, zero failures |
| `node validation/mono-browser-check.mjs` | 210 entries, zero failures; all eight screen families, responsive/RTL and gesture regression matrix |
| `$env:AUTH_LIVE='1'; $env:AUTH_TEST_ORIGIN='http://127.0.0.1:5174'; node validation/auth-browser-check.mjs` | Six groups passed, including real disposable SQLite auth and cross-tab logout during synthetic capture |
| `$env:AUTH_TEST_ORIGIN='http://127.0.0.1:4175'; node validation/auth-proxy-check.mjs` | Passed: signup 201, duplicate 409, `/me` 200, logout 204, signed-out 401, HttpOnly cookie invisibility, no-store, active worker exclusion and offline identity failure |
| `node validation/mono-scope-check.mjs <evidence-root>` | Passed: protected hashes, exact media/lifecycle/submission implementation, branch/HEAD/index and source-path inventory |

The matrix uses 320×568, 360×640, 390×844, 430×932, 844×390, 768×1024 and 1280×800 in EN/AR, with 200% text at 320/390, keyboard-sized layouts, reduced motion and forced colors. It includes landing/forms/errors, Welcome, Home selection, Assistant phases, long answers, empty/populated/expanded History, details/zoom, Settings/account, Help/safety, Connection/ticket/copy fallback and confirmations. It checks mouse, native Chromium touch events, keyboard and synthesized activation separately. All media, questions and records used in browser UI tests are synthetic and isolated.

Measured browser-computed contrast: muted text on inset **4.64:1**, muted on page **4.97:1**, tactile white text **14.16:1**, current nav text **14.81:1**, and opaque hold/camera labels **16.29:1**. Token checks additionally cover success 4.77:1, warning 7.52:1, danger 5.76:1 and input borders 5.10:1. Pale decorative card/divider lines are not relied on as the sole control identification. This is not formal WCAG certification.

Temporary evidence root:
`C:\Users\user\AppData\Local\Temp\aether-mono-69c58635f9f945fd9337c1ea4ebf559d`

It contains `baseline.json`, `pre-existing.diff`, original App/AuthScreen snapshots, `final-audit.json` and `contrast.json`. The real integration backend used only the new `auth-mono-fixture.sqlite3` in this directory, with the pre-existing external virtual environment, `AUTH_DB_PATH` set explicitly, bytecode writing disabled and loopback port 18062. Neither the ordinary development database nor the backend default database was used.

Representative screenshot/result roots, all outside the repository:

- Mono matrix: `C:\Users\user\AppData\Local\Temp\aether-mono-browser-Tk9VyD`
- Latest History matrix: `C:\Users\user\AppData\Local\Temp\echosight-history-check-iAdA26`
- Auth/live integration: `C:\Users\user\AppData\Local\Temp\echosight-auth-browser-7JNWai`
- Edge regression: `C:\Users\user\AppData\Local\Temp\echosight-history-check-nrcFtF`
- Visually reviewed eight-family contact sheets: `C:\Users\user\AppData\Local\Temp\aether-mono-browser-A0ueJV\contact-en.png` and `contact-ar.png`; individual auth, long-answer, Home and large Arabic screenshots were also opened and inspected.

Visual refinement corrected 320px/200% horizontal overflow, header wrapping, fan geometry/stacking, and excess Home feature-card height. The review includes the lower Settings/account and Help/safety content and the honest cassette fallback. Fallback-font screenshots are not proof of Google Font loading, native-device accessibility or live cloud behavior.

## Preservation audit and process

The preflight inventory contains 314 existing tracked/untracked files. All **304 files outside the exact existing-file UI/test allowlist** match their original SHA-256. All nine protected App helper/media/language/history functions and all four original lifecycle effects retain their exact implementation and ordering. AuthScreen's complete existing submit callback is unchanged. The Git index hash, branch, HEAD and empty staging area match the baseline. The protected `.env.local` was never written; its modification timestamp remains 2026-10-30T22:52:03.110Z. The audit also preserves all 166 baseline validation files outside the two intentionally updated browser test sources.

No staging, commit, push, pull, fetch, merge, branch creation/switch, PR or deployment occurred. No dependency, toolchain, auth proxy, cookie, database schema, network configuration, server contract, backend source, speech provider or streaming engine was changed. No real camera/microphone, paid AI/speech provider, public tunnel or real account data was used. Only this task's identified loopback development/preview/test-backend processes were started, and they are stopped after validation. No permanent launcher was created.

## Physical iPhone acceptance still required

- On an independently authorized HTTPS setup, check actual Inter/Pirata One/Noto Sans Arabic loading, installed-name inconsistency, safe areas, zoom, real keyboard, landscape and Dynamic Type.
- Use VoiceOver through landing/forms, Welcome, all destinations, dialogs, answer text and photo details. Check focus restoration, Arabic shaping/RTL, reduced motion and spoken status without feedback loops.
- Confirm real permission-denied and voice-only paths; Start requests capture once; Stop options works without timed holding; hold/release/cancel and Stop → Start work with actual touch.
- Verify actual microphone/STT/TTS, English playback limitation, WHIP path/session identity and rear-camera preview. Chromium synthetic media does not validate these services.
- Log in A → Start/ask → logout (including network failure and another-tab logout) → ensure capture/speech stop → log in B with no A content → return to A on the same origin and confirm surviving text/photos and no stale Undo.
- Reload and background/foreground the PWA; verify explicit Resume, conservative after-pause photo association, local retention and clipboard/haptics limitations.

Later voice/evidence integration should expose supported playback state/settings, permission capabilities, explicit question submission, uncertainty/evidence metadata and service diagnostics through agreed public interfaces. Those changes require their owners and contracts; this UI task implements none of them.
