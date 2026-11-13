export type Endpoints = { backend: string; media: string; voice?: string; allowLan: boolean };
// EXPO_PUBLIC_AETHER_HOST (set when building) prefills the laptop's address on first launch.
const buildHost = process.env.EXPO_PUBLIC_AETHER_HOST;
export const defaultEndpoints: Endpoints = {
  backend: process.env.EXPO_PUBLIC_AETHER_BACKEND_URL || (buildHost ? `http://${buildHost}:8002` : 'https://localhost:8002'),
  media: process.env.EXPO_PUBLIC_AETHER_MEDIA_URL || (buildHost ? `http://${buildHost}:8889` : 'https://localhost:8889'),
  allowLan: !!buildHost,
};
export function privateHost(host: string) {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}
export function validateOrigin(value: string, allowLan: boolean) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw Error('invalid_origin');
  if (url.protocol === 'http:' && (!allowLan || !privateHost(url.hostname))) throw Error('https_required');
  return url.origin;
}
export function validateEndpoints(value: Endpoints): Endpoints {
  if (!value) throw Error('invalid_origin');
  const allowLan = value.allowLan === true;
  const endpoints = { backend: validateOrigin(value.backend, allowLan), media: validateOrigin(value.media, allowLan), allowLan };
  if (!value.voice?.trim()) return endpoints;
  const voice = validateOrigin(value.voice, allowLan);
  if (new URL(voice).hostname !== new URL(endpoints.backend).hostname) throw Error('voice_host_mismatch');
  return { ...endpoints, voice };
}
// Retired development connections become a shared-server draft. Do not send
// credentials to a replacement backend until the user saves the new connection.
export function restoreConnection(value: Endpoints) {
  const endpoints = validateEndpoints(value), backend = new URL(endpoints.backend);
  const needsConfirmation = backend.port === '18063';
  if (needsConfirmation) { backend.port = '8002'; endpoints.backend = backend.origin; }
  return { endpoints, needsConfirmation };
}
export async function boundedFetch(url: string, options: RequestInit = {}, ms = 8000, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, ms);
  try {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal });
    if (response.redirected || response.url && new URL(response.url).origin !== new URL(url).origin) throw Error('redirect_rejected');
    const body = response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();
    // React Native's Response polyfill reads ArrayBuffer text byte by byte, corrupting
    // UTF-8 Arabic/French into characters such as Ø/Ù. Decode text before rebuilding
    // the response; keep binary bodies intact and the whole read inside the timeout.
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const text = type.startsWith('text/') || type === 'application/json' || type.endsWith('+json');
    const payload = body !== null && text ? new TextDecoder('utf-8', { fatal: true }).decode(body) : body;
    return new Response(payload, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
// Recognizes the account API without assuming that the backend implements /health.
// Anonymous reachability alone does not prove database persistence.
export async function probeBackend(origin: string, fetcher: typeof fetch = fetch) {
  const response = await boundedFetch(`${origin}/api/v1/auth/me`, { credentials: 'omit', headers: { Accept: 'application/json' } }, 8000, fetcher);
  const data = await response.json().catch(() => null);
  if (response.status === 200 ? !data?.user : response.status !== 401 || data?.error?.code !== 'not_authenticated') throw Error('backend_unavailable');
}
