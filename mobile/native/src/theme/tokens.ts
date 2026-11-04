// Semantic values copied from mobile/frontend/src/styles/tokens.css at bb54dbd.
export const light = { bg: '#FCFCFC', card: '#FFFFFF', inset: '#F4F4F4', ink: '#202020', ink2: '#3A3A3A', muted: '#6E6E6E', line: '#E3E3E3', lineCard: '#EAEAEA', divider: '#F0F0F3', ok: '#0F7A4E', okBg: '#E3F6EE', warn: '#7C3F05', warnBg: '#FFF4E5', danger: '#B42318', dangerBg: '#FDECEC', tactile: '#2B2B2B', edge: '#000000', cassette: '#2B2B2B', reel: '#E8E2D4', paper: '#F7F3E8', track: '#3A3B40' };
// The PWA has no dark mapping. Preserve monochrome semantics with readable contrast.
export const dark: typeof light = { ...light, bg: '#141414', card: '#202020', inset: '#2B2B2B', ink: '#FCFCFC', ink2: '#E3E3E3', muted: '#B8B8B8', line: '#494949', lineCard: '#3A3A3A', divider: '#343434', ok: '#85DDB1', okBg: '#183A2B', warn: '#FFD8A6', warnBg: '#3B2B1C', danger: '#FFB4AB', dangerBg: '#462321' };
export const geometry = { card: 14, inset: 10, button: 10, hit: 48, start: 92, space: 20 };
