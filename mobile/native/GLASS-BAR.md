# Floating glass navigation

The bottom navigation uses `expo-glass-effect` 58.0.5 for native Liquid Glass on supported iOS 26+ builds. It floats over scrolling content, with a sliding selected-tab capsule, English/Arabic labels, theme-aware colors, and the existing Assistant start action. The full-screen camera retains its own controls.

The native module must be included in a rebuilt development IPA. Reloading JavaScript in an older installed client shows the rounded, shaded fallback; it does not add the native glass module. Older iOS versions and Android also use the fallback. Reduce Transparency selects an opaque surface, and the app's Motion preference and system Reduce Motion setting disable the selection animation.

The frame measures the bar to keep the last content item reachable, including with enlarged text. The bar hides while the software keyboard is open.

Verified locally: TypeScript, lint, 31 component/integration tests, and iOS/Android Hermes exports. Tests cover the missing-module guard, unsupported glass APIs, Reduce Transparency changes, both languages' navigation actions, and keyboard/content spacing. These are automated checks; the glass material, scrolling appearance, VoiceOver, and enlarged text still need visual checks on a rebuilt iPhone app.

Use the existing **iPhone development IPA for sideloading** workflow when this branch is pushed. Its manual **Run workflow** action can target this branch; the current push trigger only builds the earlier named branches. Install the resulting IPA through the established Sideloadly process.

API reference: [Expo GlassEffect](https://docs.expo.dev/versions/latest/sdk/glass-effect/).
