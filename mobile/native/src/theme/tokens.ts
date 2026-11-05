// Semantic values copied from mobile/frontend/src/styles/tokens.css at bb54dbd.
export const light = { bg: '#FCFCFC', card: '#FFFFFF', inset: '#F4F4F4', ink: '#202020', ink2: '#3A3A3A', muted: '#6E6E6E', line: '#E3E3E3', lineCard: '#EAEAEA', divider: '#F0F0F3', ok: '#0F7A4E', okBg: '#E3F6EE', warn: '#7C3F05', warnBg: '#FFF4E5', danger: '#B42318', dangerBg: '#FDECEC', tactile: '#2B2B2B', onTactile: '#FFFFFF', edge: '#000000', scrim: '#20202099', cassette: '#2B2B2B', reel: '#E8E2D4', paper: '#F7F3E8', track: '#3A3B40' };
// The PWA has no dark mapping. Preserve monochrome semantics with readable contrast.
// Primary buttons invert in dark mode, so they stay the strongest thing on a dark card.
export const dark: typeof light = { ...light, bg: '#141414', card: '#202020', inset: '#2B2B2B', ink: '#FCFCFC', ink2: '#E3E3E3', muted: '#B8B8B8', line: '#494949', lineCard: '#3A3A3A', divider: '#343434', ok: '#85DDB1', okBg: '#183A2B', warn: '#FFD8A6', warnBg: '#3B2B1C', danger: '#FFB4AB', dangerBg: '#462321', tactile: '#FCFCFC', onTactile: '#141414', edge: '#8E8E8E', scrim: '#000000B3', track: '#696861' };
export const geometry = { card: 14, inset: 10, button: 10, hit: 48, start: 92, space: 20 };

export type ThemeMode = 'system' | 'light' | 'dark';
export const themeModes: readonly ThemeMode[] = ['system', 'light', 'dark'];
// Anything saved that isn't a known mode falls back to following the phone.
export const parseThemeMode = (raw: unknown): ThemeMode => themeModes.includes(raw as ThemeMode) ? raw as ThemeMode : 'system';
export const resolveScheme = (mode: ThemeMode, system: string | null | undefined): 'light' | 'dark' => mode === 'system' ? system === 'dark' ? 'dark' : 'light' : mode;
