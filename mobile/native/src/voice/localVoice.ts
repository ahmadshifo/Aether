import { requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';
import type { Language } from '../shared/types';
import type { RecognitionEvents } from '../session/controller';
import { boundedFetch } from '../platform/config';
import { nativeFetch } from '../platform/network';
import { duringPermission } from '../platform/permissions';
import { prepareRecognition, recognize } from './recognition';
import { decode64, encode64, UtteranceBuffer } from './pcm';

type Subscription = { remove(): void };
interface MemoryAudio {
  routeSpeaker?(enabled: boolean): Promise<void>;
  prepare(): Promise<boolean>;
  startCapture(captureId: string): Promise<void>;
  stopCapture(): Promise<void>;
  play(wav: string, rate: number, playbackId: string): Promise<'done' | 'cancelled'>;
  stopPlayback(): Promise<void>;
  addListener(name: string, listener: (event: { pcm: string; rms: number; capture_id?: string; playback_id?: string }) => void): Subscription;
}
export const memoryAudio = requireOptionalNativeModule<MemoryAudio>('AetherAudio');
export const localVoiceCopy = {
  en: 'Local voice is unavailable. Using your phone’s voice; you may need to repeat your question.',
  ar: 'الصوت المحلي غير متاح. نستخدم صوت الهاتف؛ قد تحتاج إلى إعادة السؤال.',
  fr: 'La voix locale est indisponible. La voix du téléphone est utilisée ; répétez votre question si nécessaire.',
};

export class LocalVoice {
  private unavailableUntil = 0;
  private deviceOfflineUntil = 0;
  private announced = false;
  constructor(private origin: string, private fallbackNotice: (language: Language) => void,
    private unauthorized: () => void, private audio = memoryAudio, private onRestored?: () => void) {}
  get available() { return !!this.audio; }
  private fallback(language: Language) {
    if (this.unavailableUntil <= Date.now()) this.unavailableUntil = Date.now() + 60000;
    if (!this.announced) { this.announced = true; this.fallbackNotice(language); }
  }
  private restored() { if (this.announced) this.onRestored?.(); this.announced = false; }
  private async request(path: string, options: RequestInit, ms: number) {
    const result = await boundedFetch(`${this.origin}/api/v1/voice/${path}`, { credentials: 'include', ...options }, ms, nativeFetch);
    if (result.status === 401) this.unauthorized();
    if (!result.ok) throw Error('voice_unavailable');
    return result;
  }
  prepare = async (signal: AbortSignal) => {
    if (!this.audio) return prepareRecognition(signal);
    const granted = await duringPermission(async () => {
      if (Platform.OS === 'android') return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) === PermissionsAndroid.RESULTS.GRANTED;
      return this.audio!.prepare();
    }, signal);
    if (!signal.aborted && !granted) throw Error('recognition_denied');
  };
  stopPlayback = async () => { await this.audio?.stopPlayback().catch(() => {}); };
  speak = async (text: string, language: Language, rate: number, onStart: () => void, signal: AbortSignal): Promise<'done' | 'cancelled' | null> => {
    if (signal.aborted) return 'cancelled';
    if (!this.audio || Date.now() < this.unavailableUntil) { this.fallback(language); return null; }
    let subscription: Subscription | undefined;
    const abort = () => { void this.stopPlayback(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.request('tts', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: language }) }, 30000);
      if (signal.aborted) return 'cancelled';
      const wav = new Uint8Array(await response.arrayBuffer());
      if (signal.aborted) return 'cancelled';
      if (wav.length > 16 * 1024 * 1024 || !response.headers.get('content-type')?.includes('audio/wav')) throw Error('invalid_audio');
      const playbackId = `${Date.now()}-${Math.random()}`;
      subscription = this.audio.addListener('playbackStarted', event => { if (event.playback_id === playbackId && !signal.aborted) onStart(); });
      const result = await this.audio.play(encode64(wav), rate, playbackId);
      if (!signal.aborted) this.restored();
      return signal.aborted ? 'cancelled' : result;
    } catch {
      if (signal.aborted) return 'cancelled';
      this.fallback(language); return null;
    } finally {
      subscription?.remove(); signal.removeEventListener('abort', abort);
    }
  };
  recognize = async (language: Language, events: RecognitionEvents, signal: AbortSignal): Promise<() => Promise<void>> => {
    const device = () => recognize(language, { ...events, error: code => {
      if (code === 'network' || code === 'server') this.deviceOfflineUntil = Date.now() + 60000;
      events.error(code);
    } }, signal, { onDevice: Date.now() < this.deviceOfflineUntil });
    if (!this.audio || Date.now() < this.unavailableUntil) { this.fallback(language); return device(); }
    try {
      await this.request('health', { signal }, 3000);
      await this.prepare(signal);
    } catch {
      if (signal.aborted) return async () => {};
      this.fallback(language); return device();
    }
    if (signal.aborted) return async () => {};
    const audio = this.audio, buffer = new UtteranceBuffer();
    const captureId = `${Date.now()}-${Math.random()}`;
    const pending = new AbortController();
    let stopped = false, processing = false, fallbackStop: (() => Promise<void>) | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const subscriptions: Subscription[] = [];
    const release = async () => {
      clearTimeout(idle); subscriptions.splice(0).forEach(item => item.remove()); buffer.clear();
      await audio.stopCapture().catch(() => {});
    };
    let stopPromise: Promise<void> | undefined;
    const stop = () => stopPromise ??= (async () => {
      stopped = true; pending.abort(); signal.removeEventListener('abort', abort);
      await release(); await fallbackStop?.();
    })();
    const abort = () => { void stop(); };
    signal.addEventListener('abort', abort, { once: true });
    const fail = async () => {
      if (stopped || signal.aborted) return;
      processing = true; await release(); this.fallback(language);
      if (stopped || signal.aborted) return;
      try { fallbackStop = await device(); if (stopped) await fallbackStop(); }
      catch { if (!stopped) events.error('audio-capture'); }
    };
    subscriptions.push(audio.addListener('captureError', event => { if (event.capture_id === captureId && !processing) void fail(); }));
    subscriptions.push(audio.addListener('audio', event => {
      if (event.capture_id !== captureId || stopped || processing || signal.aborted) return;
      let wav: Uint8Array | null;
      try { wav = buffer.push(decode64(event.pcm), event.rms); } catch { void fail(); return; }
      if (!wav) return;
      processing = true;
      void (async () => {
        await release();
        if (stopped) return;
        const response = await this.request(`stt?lang=${language}`, { method: 'POST', signal: pending.signal,
          headers: { 'Content-Type': 'audio/wav' }, body: wav!.buffer as ArrayBuffer }, 60000);
        const result = await response.json();
        if (stopped || signal.aborted) return;
        if (result.lang !== language || typeof result.text !== 'string') throw Error('invalid_transcript');
        this.restored();
        if (result.text.trim()) events.result(result.text, true);
        if (!stopped && !signal.aborted) events.end();
      })().catch(() => { if (!stopped) void fail(); });
    }));
    try {
      await audio.startCapture(captureId);
      if (stopped || signal.aborted) { await audio.stopCapture(); return stop; }
      events.start();
      idle = setTimeout(() => { if (!processing && !stopped) { void release().then(() => { if (!stopped) events.end(); }); } }, 18000);
    } catch { await fail(); }
    return stop;
  };
}
