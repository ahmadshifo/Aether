# Source inventory and provenance

All paths are relative to `mobile/native/`. Application imports stay inside this app and its installed packages.

| Area | Files / responsibility |
| --- | --- |
| Entry/config | `App.tsx`, `index.ts`, `app.config.js`, `metro.config.cjs`, `tsconfig.json`, package/lockfile, `.npmrc`, `.gitignore`, `jest.config.cjs` |
| Screens | `src/screens/Account.tsx` (Welcome/Home/Assistant/Settings and route owner), `AuthScreen.tsx`, `HistoryScreen.tsx`, `HelpScreen.tsx`, `ConnectionScreen.tsx` |
| Native UI | `src/components/ui.tsx` (type/cards/buttons/modals/hold/receipt/cassette/mark), `Frame.tsx` (safe area/keyboard/header/footer), `Icon.tsx` |
| Copy/theme/types | `src/i18n/{monoCopy,uiCopy,authCopy,nativeCopy}.ts`, `src/theme/tokens.ts`, `src/shared/types.ts` |
| Auth | `src/auth/{authClient,authController}.ts` |
| Session/voice | `src/session/controller.ts`, `src/voice/{demo,recognition,speech}.ts` |
| Platform | `src/platform/{capabilities,config,network,permissions}.ts`, `camera.tsx` |
| Streaming | `src/streaming/{whip,registry,codecs}.ts` |
| Storage | `src/storage/{history,nativeStorage}.ts` |
| Fixture/plugin | `dev-server/server.mjs`, `plugins/withLocalNetwork.cjs` |
| Assets | `assets/{icon,adaptive-icon}.png`; five TTFs, four OFL licenses and provenance under `assets/fonts/` |
| Tests | `tests/{auth,fixture,history,permissions,session,whip}.test.mjs`, `ui.native.test.tsx`, `nativeSetup.cjs` |
| Scripts | `scripts/{audit,expo,brand-assets,live-smoke}.mjs`, `stop-preview.ps1` |
| Reports | README, INSTALL, PARITY, COMPATIBILITY, VALIDATION, this inventory, `validation/DEVICE-CHECKLIST.md` |
| Ignored generated/runtime | `node_modules/`, `.npm-cache/`, `.runtime/` (accounts.sqlite3, logs, template, Expo settings), `.expo/`, `android/`, `dist/`, `validation/artifacts/` |

## Source provenance

- Dictionaries copy the corresponding local `mobile/frontend/src/{components/ui/monoCopy,uiCopy,authCopy}.ts` content at `bb54dbd`. New native wording overrides are centralized in `nativeCopy.ts`; all source files remain untouched.
- Auth client/controller adapt local PWA files with explicit origins, native fetch, redirect guards, fresh-auth endpoint barrier and background/disposal handling.
- History adapts PWA `historyRepository.ts` semantics/constants to a single native JSON/app-private-file strategy. No IndexedDB, browser Blob serialization, legacy account or personal-media import.
- Demo text/validation derive from PWA `voiceSession.ts`; the native session/recognition/speech modules reimplement the observable lifecycle without browser globals.
- WHIP preserves PWA publisher behavior through a native peer port. Registry requests use the supplied existing endpoint/body contract; newer production response source was absent and is not claimed verified.
- Icon paths derive from PWA `EchoIcon.tsx`; exact light tokens from CSS. Native UI follows MonoShell/Brand/Buttons/styles. Dark mapping and simpler stable logo/text animation are documented adaptations.
- SQLite fixture adapts validation, scrypt and opaque-cookie semantics from locally inspected `web/ai-backend/app/auth.py` at bb54dbd. That module was never imported or executed. The small stream table is testing compatibility, not the multimedia schema.
- Entry/SDK choice follows official `expo-template-blank-typescript@58.0.32` (0BSD), extracted without Git initialization. No old Expo app code was used.
- Font provenance/licenses are in `assets/fonts/PROVENANCE.md`. Launcher images reproducibly rasterize the existing two-eye geometry using `scripts/brand-assets.mjs`.

No synthetic History is inserted into actual accounts. Synthetic accounts/media exist only in isolated tests; Go's typed-question path is explicitly labeled development input.
