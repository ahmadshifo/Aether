import { boundedFetch, privateHost, validateOrigin, type Endpoints } from '../platform/config.ts';
import type { Language } from '../shared/types.ts';

export function voiceOrigin(endpoints: Endpoints) {
  const backend = new URL(endpoints.backend);
  const inferred = new URL(backend.origin);
  if (privateHost(inferred.hostname)) inferred.port = '8001';
  const origin = validateOrigin(endpoints.voice || inferred.origin, endpoints.allowLan);
  // The shared account cookie is host-scoped. Never forward it to a different host.
  if (new URL(origin).hostname !== backend.hostname) throw Error('voice_host_mismatch');
  return origin;
}

export function createVoiceApi(origin: string, fetcher: typeof fetch = fetch, unauthorized = () => {}) {
  async function send(path: string, options: RequestInit, signal: AbortSignal, timeout = 70000) {
    let response: Response;
    try { response = await boundedFetch(origin + path, { ...options, signal, credentials: 'include', cache: 'no-store',
      headers: { 'X-Aether-Voice': '1', ...options.headers } }, timeout, fetcher); }
    catch { throw Error(signal.aborted ? 'cancelled' : 'voice_unavailable'); }
    if (signal.aborted) throw Error('cancelled');
    if (response.status === 401) { unauthorized(); throw Error('auth_lost'); }
    if (!response.ok) {
      const body = await response.json().catch(() => null), code = body?.error?.code;
      throw Error(response.status === 429 ? 'voice_quota' : typeof code === 'string' && /^voice_[a-z_]+$/.test(code) ? code : 'voice_unavailable');
    }
    return response;
  }
  return {
    async check(signal: AbortSignal) {
      const response = await send('/health', { method: 'GET' }, signal, 6000);
      const data = await response.json();
      if (data?.service !== 'aether-voice') throw Error('voice_unavailable');
      if (!data.audio_ready) throw Error('voice_audio_unavailable');
      if (!data.configured) throw Error('voice_unconfigured');
    },
    async transcribe(bytes: Uint8Array, language: Language, signal: AbortSignal) {
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw Error('voice_audio_size');
      // expo/fetch cannot upload RN FormData uri parts. Send the actual recorded bytes.
      const boundary = `aether-${Date.now()}-${Math.random().toString(36).slice(2)}`, encoder = new TextEncoder();
      const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="question.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`);
      const tail = encoder.encode(`\r\n--${boundary}--\r\n`), body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
      const response = await send('/api/v1/voice/transcribe', { method: 'POST', body,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, signal);
      const result = await response.json();
      if (result?.language !== language || typeof result.text !== 'string' || result.text.length > 4000) throw Error('voice_provider');
      return result.text.trim() as string;
    },
    async synthesize(text: string, language: Language, signal: AbortSignal) {
      if (!text.trim() || [...text].length > 1200) throw Error('voice_text_size');
      const response = await send('/api/v1/voice/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }) }, signal);
      if (!response.headers.get('content-type')?.startsWith('audio/mpeg')) throw Error('voice_provider');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw Error('voice_provider');
      return bytes;
    },
  };
}
export type VoiceApi = ReturnType<typeof createVoiceApi>;
