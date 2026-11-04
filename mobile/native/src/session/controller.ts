import type { Entry, Language, Phase, Photo } from '../shared/types.ts';
import { demoAnswer, validTranscript } from '../voice/demo.ts';
import type { Transport } from '../streaming/whip.ts';
export interface CameraHandle { url?: string; release(): void; snapshot?(): Promise<{ uri: string; capturedAt: string } | undefined> }
export interface RecognitionEvents { start(): void; result(text: string, final: boolean, confidence?: number): void; end(): void; error(code: string): void }
export interface SessionPorts {
  preview: boolean; recognitionAvailable: boolean; streamingAvailable: boolean;
  uuid(): string; allowed(): boolean;
  camera(signal: AbortSignal): Promise<CameraHandle>;
  recognition(language: Language, events: RecognitionEvents, signal: AbortSignal): Promise<() => Promise<void>>;
  speak(text: string, language: Language, started: () => void): Promise<'done' | 'cancelled' | 'error'>;
  stopSpeech(): void;
  publish(camera: CameraHandle, id: string, state: (value: Transport) => void): { start(): Promise<void>; stop(): void };
  register(action: 'start' | 'stop', id: string): Promise<void>;
  keepAwake(active: boolean): void;
  savePhoto?(snapshot: { uri: string; capturedAt: string }, valid: () => boolean): Promise<Photo | undefined>;
  discardPhoto?(photo?: Photo): void;
  discardSnapshot?(snapshot: { uri: string; capturedAt: string }): void;
  answer(entry: Entry): void;
}
export type SessionState = { active: boolean; id?: string; startedAt?: string; phase: Phase; camera: boolean; cameraUrl?: string; transport: Transport; registry: 'off' | 'pending' | 'registered' | 'failed'; transcript: string; answer?: Entry; error: string; cameraError: string; voiceError: string };
const initial: SessionState = { active: false, phase: 'idle', camera: false, transport: 'off', registry: 'off', transcript: '', error: '', cameraError: '', voiceError: '' };
export class SessionController {
  private state = initial;
  private listeners = new Set<() => void>();
  private generation = 0;
  private questionGeneration = 0;
  private speechGeneration = 0;
  private recognitionGeneration = 0;
  private capture?: CameraHandle;
  private publisher?: ReturnType<SessionPorts['publish']>;
  private stopRecognition?: () => Promise<void>;
  private recognitionStartup?: Promise<() => Promise<void>>;
  private silencing = Promise.resolve();
  private request = new AbortController();
  private recognitionRequest?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private lastQuestion = '';
  private lastAt = 0;
  private language: Language = 'en';
  private ports: SessionPorts;
  constructor(ports: SessionPorts) { this.ports = ports; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<SessionState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private valid(g: number) { return g === this.generation && this.state.active && this.ports.allowed(); }
  async start(language: Language) {
    if (!this.ports.allowed() || this.state.active) return;
    this.ports.stopSpeech(); this.speechGeneration++;
    const g = ++this.generation; this.language = language; this.request = new AbortController(); this.retries = 0; this.lastQuestion = '';
    const id = this.ports.uuid();
    this.set({ ...initial, active: true, id, startedAt: new Date().toISOString(), phase: 'starting' });
    this.ports.keepAwake(true);
    // Camera and OS permission acquisition begin only from this explicit action.
    const camera = this.openCamera(g, id);
    const voice = this.ports.recognitionAvailable ? this.listen(g) : Promise.resolve();
    await Promise.allSettled([camera, voice]);
    if (!this.valid(g)) return;
    if (!this.ports.recognitionAvailable) this.set({ phase: 'unavailable', voiceError: 'native_required' });
  }
  private async openCamera(g: number, id: string) {
    try {
      const capture = await this.ports.camera(this.request.signal);
      if (!this.valid(g)) { capture.release(); return; }
      this.capture = capture; this.set({ camera: true, cameraUrl: capture.url });
      if (!this.ports.streamingAvailable) return;
      this.set({ registry: 'pending' });
      void this.ports.register('start', id).then(() => {
        if (this.valid(g)) this.set({ registry: 'registered' });
        else void this.ports.register('stop', id).catch(() => {});
      }).catch(() => { if (this.valid(g)) this.set({ registry: 'failed' }); });
      try {
        const publisher = this.ports.publish(capture, id, transport => { if (this.valid(g)) this.set({ transport }); });
        this.publisher = publisher;
        void publisher.start().catch(() => { if (this.valid(g)) this.set({ transport: 'failed' }); });
      } catch { if (this.valid(g)) this.set({ transport: 'failed' }); }
    } catch { if (this.valid(g)) this.set({ camera: false, cameraError: 'camera_denied' }); }
  }
  private async listen(g: number) {
    if (!this.valid(g) || !this.ports.recognitionAvailable) return;
    await this.silenceInput();
    if (!this.valid(g)) return;
    const r = ++this.recognitionGeneration;
    const request = new AbortController(); this.recognitionRequest = request;
    const valid = () => this.valid(g) && r === this.recognitionGeneration && !request.signal.aborted;
    this.set({ phase: 'starting', voiceError: '' });
    try {
      const pending = Promise.resolve().then(() => !valid() ? async () => {} : this.ports.recognition(this.language, {
        start: () => { if (valid()) this.set({ phase: 'listening' }); },
        result: (text, final, confidence) => {
          if (!valid() || !['starting', 'listening', 'hearing'].includes(this.state.phase)) return;
          this.set({ transcript: text, phase: 'hearing' });
          if (final && validTranscript(text, confidence)) { this.retries = 0; void this.question(text, 'speech'); }
        },
        end: () => { if (valid() && ['starting', 'listening', 'hearing'].includes(this.state.phase)) this.retry(g); },
        error: code => {
          if (!valid()) return;
          if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) { this.stop(); this.set({ phase: 'error', voiceError: 'recognition_denied' }); }
          else if (code === 'language-not-supported') { this.pause(); this.set({ voiceError: 'language_unavailable' }); }
          else { this.set({ voiceError: code === 'no-speech' ? 'silence' : 'recognition_failed' }); this.retry(g); }
        },
      }, request.signal));
      this.recognitionStartup = pending;
      const stop = await pending;
      if (this.recognitionStartup === pending) this.recognitionStartup = undefined;
      if (!valid()) { await stop(); return; }
      this.stopRecognition = stop;
    } catch {
      if (valid()) { this.stop(); this.set({ phase: 'error', voiceError: 'recognition_denied' }); }
    }
  }
  private retry(g: number) {
    if (this.retryTimer) return;
    if (++this.retries > 3) { this.pause(); this.set({ voiceError: 'recognition_failed' }); return; }
    this.set({ phase: 'starting' });
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (this.valid(g)) void this.listen(g); }, 400 * this.retries);
  }
  private async silenceInput() {
    this.recognitionGeneration++; this.recognitionRequest?.abort(); this.recognitionRequest = undefined;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    const stop = this.stopRecognition, pending = this.recognitionStartup;
    this.stopRecognition = undefined; this.recognitionStartup = undefined;
    const previous = this.silencing;
    this.silencing = Promise.allSettled([previous, stop ? stop() : pending?.then(release => release())]).then(() => {});
    await this.silencing;
  }
  async typedQuestion(text: string) { if (this.ports.preview) await this.question(text, 'typed'); }
  private async question(text: string, input: 'speech' | 'typed') {
    const g = this.generation;
    if (!this.valid(g) || ['processing', 'speaking', 'paused'].includes(this.state.phase) || !validTranscript(text)) return;
    const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized === this.lastQuestion && Date.now() - this.lastAt < 4500) return;
    this.lastQuestion = normalized; this.lastAt = Date.now();
    const q = ++this.questionGeneration, questionId = this.ports.uuid(), lang = this.language;
    const valid = () => this.valid(g) && q === this.questionGeneration && lang === this.language;
    this.set({ phase: 'processing', transcript: text });
    // Capture at final question time, before speech shutdown or any answer work.
    const frame = this.capture?.snapshot?.().catch(() => undefined);
    await this.silenceInput();
    const snapshot = await frame;
    if (!valid()) { if (snapshot) this.ports.discardSnapshot?.(snapshot); return; }
    const photo = snapshot ? await this.ports.savePhoto?.(snapshot, valid).catch(() => undefined) : undefined;
    if (!valid()) { this.ports.discardPhoto?.(photo); return; }
    const entry: Entry = { id: this.ports.uuid(), questionId, sessionId: this.state.id!, question: text.trim(), answer: demoAnswer(text, lang, this.state.camera), language: lang, demo: true, input, createdAt: new Date().toISOString(), ...(photo ? { photo } : {}) };
    this.set({ answer: entry }); this.ports.answer(entry);
    await this.play(entry, true);
  }
  async replay(entry: Entry) { if (this.ports.allowed()) await this.play(entry, this.state.active && this.state.phase !== 'paused' && entry === this.state.answer); }
  private async play(entry: Entry, resume: boolean) {
    const g = this.generation, token = ++this.speechGeneration;
    this.ports.stopSpeech(); await this.silenceInput();
    if (token !== this.speechGeneration || !this.ports.allowed() || g !== this.generation) return;
    const result = await this.ports.speak(entry.answer, entry.language, () => { if (token === this.speechGeneration && this.ports.allowed()) this.set({ phase: 'speaking' }); });
    if (token !== this.speechGeneration || !this.ports.allowed() || g !== this.generation) return;
    this.set({ phase: this.state.active ? 'paused' : 'idle', ...(result === 'error' ? { voiceError: 'tts_failed' } : {}) });
    if (result === 'done' && resume && this.valid(g) && this.ports.recognitionAvailable) {
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (this.valid(g)) void this.listen(g); }, 450);
    } else if (this.valid(g) && this.ports.preview) this.set({ phase: 'unavailable' });
  }
  stopPlayback() { this.speechGeneration++; this.ports.stopSpeech(); if (this.state.phase === 'speaking') this.set({ phase: this.state.active ? 'paused' : 'idle' }); }
  pause() { this.questionGeneration++; this.stopPlayback(); void this.silenceInput(); if (this.state.active) this.set({ phase: 'paused', transcript: '' }); }
  resume() { if (this.state.active && this.ports.allowed()) { this.retries = 0; if (this.ports.recognitionAvailable) void this.listen(this.generation); else this.set({ phase: 'unavailable' }); } }
  changeLanguage(lang: Language) { if (lang === this.language) return; this.language = lang; this.pause(); }
  stop(background = false) {
    const id = this.state.id, wasActive = this.state.active;
    this.generation++; this.questionGeneration++; this.speechGeneration++;
    this.request.abort(); void this.silenceInput(); this.ports.stopSpeech();
    try { this.publisher?.stop(); } catch { /* Continue every independent cleanup. */ } this.publisher = undefined;
    try { this.capture?.release(); } catch { /* Native resource may already be released. */ } this.capture = undefined;
    this.ports.keepAwake(false);
    this.set({ ...initial, id, startedAt: this.state.startedAt, phase: background ? 'paused' : 'idle' });
    if (wasActive && id && this.ports.streamingAvailable) void this.ports.register('stop', id).catch(() => {});
  }
  dispose() { this.stop(); this.listeners.clear(); }
}
