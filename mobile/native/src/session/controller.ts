import type { Entry, Language, Phase, Photo } from '../shared/types.ts';
import { validTranscript } from '../voice/transcript.ts';
import type { Transport } from '../streaming/whip.ts';
import { sessionGreeting } from '../voice/sessionGreeting.ts';
import type { AskRequest, AskResponse } from '../services/teamApi.ts';
export interface CameraHandle { url?: string; release(): void; snapshot?(): Promise<{ uri: string; capturedAt: string } | undefined> }
export interface RecognitionEvents { start(): void; processing?(): void; result(text: string, final: boolean, confidence?: number): void; end(): void; error(code: string): void }
export interface SessionPorts {
  ask?(request: AskRequest, signal: AbortSignal): Promise<AskResponse>;
  preview: boolean; recognitionAvailable: boolean; streamingAvailable: boolean;
  uuid(): string; allowed(): boolean;
  prepareStart?(): Promise<void>;
  sessionOpened?(signal: AbortSignal): Promise<void>;
  prepareRecognition?(signal: AbortSignal): Promise<void>;
  camera(signal: AbortSignal): Promise<CameraHandle>;
  recognition(language: Language, events: RecognitionEvents, signal: AbortSignal): Promise<() => Promise<void>>;
  speak(text: string, language: Language, started: () => void): Promise<'done' | 'cancelled' | 'error'>;
  stopSpeech(): void;
  speechError?(): string;
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
  private publisherGeneration = 0;
  private stopRecognition?: () => Promise<void>;
  private recognitionStartup?: Promise<() => Promise<void>>;
  private sessionStartup?: Promise<void>;
  private silencing = Promise.resolve();
  private request = new AbortController();
  private recognitionRequest?: AbortController;
  private questionRequest?: AbortController;
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
    this.ports.stopSpeech(); const token = ++this.speechGeneration;
    const g = ++this.generation; this.language = language; this.request = new AbortController(); this.retries = 0; this.lastQuestion = '';
    const id = this.ports.uuid();
    this.set({ ...initial, active: true, id, startedAt: new Date().toISOString(), phase: 'starting' });
    this.ports.keepAwake(true);
    const pending = this.openSession(g, id, token);
    this.sessionStartup = pending;
    try { await pending; } finally { if (this.sessionStartup === pending) this.sessionStartup = undefined; }
  }
  private async openSession(g: number, id: string, token: number) {
    // Release wake-word dictation before feedback, camera acquisition, or greeting playback.
    try { await this.ports.prepareStart?.(); }
    catch { if (this.valid(g)) { this.stop(); this.set({ phase: 'error', voiceError: 'recognition_failed' }); } return; }
    if (!this.valid(g)) return;
    await this.silenceInput();
    if (!this.valid(g)) return;
    await this.ports.sessionOpened?.(this.request.signal).catch(() => {});
    if (!this.valid(g)) return;
    const camera = this.openCamera(g, id);
    const voice = this.ports.recognitionAvailable ? this.openVoice(g, token) : Promise.resolve();
    await Promise.allSettled([camera, voice]);
    if (!this.valid(g)) return;
    if (!this.ports.recognitionAvailable && this.state.phase !== 'paused') this.set({ phase: 'unavailable', voiceError: 'native_required' });
  }
  private async openVoice(g: number, token: number) {
    const valid = () => this.valid(g) && token === this.speechGeneration;
    if (!valid()) return;
    try { await this.ports.prepareRecognition?.(this.request.signal); }
    catch (error) { if (valid()) { this.stop(); this.set({ phase: 'error', voiceError: error instanceof Error && error.message.startsWith('voice_') ? error.message : 'recognition_denied' }); } return; }
    if (!valid()) return;
    // The microphone is off for the entire greeting; never store it as a question or answer.
    this.set({ phase: 'greeting' });
    const result = await this.ports.speak(sessionGreeting[this.language], this.language, () => {}).catch(() => 'error' as const);
    if (!valid()) return;
    if (result === 'error' && this.ports.speechError?.()) { this.pause(); this.set({ voiceError: this.ports.speechError() }); return; }
    await this.listen(g);
    if (valid() && result === 'error') this.set({ voiceError: this.ports.speechError?.() || 'tts_failed' });
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
      this.publishCamera(g, id, capture);
    } catch { if (this.valid(g)) this.set({ camera: false, cameraError: 'camera_denied' }); }
  }
  private publishCamera(g: number, id: string, capture: CameraHandle) {
    const p = ++this.publisherGeneration;
    this.publisher?.stop(); this.publisher = undefined;
    const valid = () => this.valid(g) && p === this.publisherGeneration;
    this.set({ transport: 'connecting' });
    try {
      const publisher = this.ports.publish(capture, id, transport => { if (valid()) this.set({ transport }); });
      this.publisher = publisher;
      void publisher.start().catch(() => { if (valid()) this.set({ transport: 'failed' }); });
    } catch { if (valid()) this.set({ transport: 'failed' }); }
  }
  retryStream() {
    const g = this.generation, id = this.state.id;
    if (!this.valid(g) || !id || !this.capture || !this.ports.streamingAvailable) return;
    if (this.state.registry === 'failed') {
      this.set({ registry: 'pending' });
      void this.ports.register('start', id).then(() => {
        if (this.valid(g)) this.set({ registry: 'registered' });
        else void this.ports.register('stop', id).catch(() => {});
      }).catch(() => { if (this.valid(g)) this.set({ registry: 'failed' }); });
    }
    if (this.state.transport === 'failed') this.publishCamera(g, id, this.capture);
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
        processing: () => { if (valid()) this.set({ phase: 'transcribing' }); },
        result: (text, final, confidence) => {
          if (!valid() || !['starting', 'listening', 'hearing', 'transcribing'].includes(this.state.phase)) return;
          this.set({ transcript: text, phase: 'hearing' });
          if (final && validTranscript(text, confidence)) { this.retries = 0; void this.question(text, 'speech'); }
        },
        end: () => { if (valid() && ['starting', 'listening', 'hearing', 'transcribing'].includes(this.state.phase)) this.retry(g); },
        error: code => {
          if (!valid()) return;
          if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) { this.stop(); this.set({ phase: 'error', voiceError: 'recognition_denied' }); }
          else if (code === 'language-not-supported') { this.pause(); this.set({ voiceError: 'language_unavailable' }); }
          // Quota/configuration errors need an explicit Resume, never an automatic paid retry loop.
          else if (code.startsWith('voice_')) { this.pause(); this.set({ voiceError: code }); }
          // Silence is not a failure: someone may take their time before asking, so it never uses up the retries.
          else { if (code === 'no-speech') this.retries = 0; this.set({ voiceError: code === 'no-speech' ? 'silence' : 'recognition_failed' }); this.retry(g); }
        },
      }, request.signal));
      this.recognitionStartup = pending;
      const stop = await pending;
      if (this.recognitionStartup === pending) this.recognitionStartup = undefined;
      if (!valid()) { await stop(); return; }
      this.stopRecognition = stop;
    } catch (error) {
      if (valid()) { this.stop(); this.set({ phase: 'error', voiceError: error instanceof Error && error.message.startsWith('voice_') ? error.message : 'recognition_denied' }); }
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
    if (!this.valid(g) || ['greeting', 'processing', 'speaking', 'paused'].includes(this.state.phase) || !validTranscript(text)) return;
    const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized === this.lastQuestion && Date.now() - this.lastAt < 4500) return;
    this.lastQuestion = normalized; this.lastAt = Date.now();
    const q = ++this.questionGeneration, questionId = this.ports.uuid(), lang = this.language;
    const valid = () => this.valid(g) && q === this.questionGeneration && lang === this.language;
    const request = new AbortController(); this.questionRequest = request;
    this.set({ phase: 'processing', transcript: text, error: '', answer: undefined });
    // Capture at final question time, before speech shutdown or any answer work.
    const frame = this.capture?.snapshot?.().catch(() => undefined);
    await this.silenceInput();
    const snapshot = await frame;
    if (!valid()) { if (snapshot) this.ports.discardSnapshot?.(snapshot); return; }
    const photo = snapshot ? await this.ports.savePhoto?.(snapshot, valid).catch(() => undefined) : undefined;
    if (!valid()) { this.ports.discardPhoto?.(photo); return; }
    let result: Pick<Entry, 'answer' | 'provenance' | 'uncertain' | 'evidenceFrameIds'>;
    try {
      if (!this.ports.ask) throw Error('answers_unavailable');
      const response = await this.ports.ask({ session_id: this.state.id!, question_id: questionId, question: text.trim(), language: lang }, request.signal);
      result = { answer: response.answer, provenance: 'server', uncertain: response.uncertain, evidenceFrameIds: response.evidence_frame_ids };
    } catch (error) {
      this.ports.discardPhoto?.(photo);
      if (valid()) { this.lastQuestion = ''; this.set({ phase: 'paused', error: error instanceof Error ? error.message : 'server_unavailable' }); }
      return;
    } finally { if (this.questionRequest === request) this.questionRequest = undefined; }
    if (!valid()) { this.ports.discardPhoto?.(photo); return; }
    const entry: Entry = { id: this.ports.uuid(), questionId, sessionId: this.state.id!, question: text.trim(), ...result, language: lang, input, createdAt: new Date().toISOString(), ...(photo ? { photo } : {}) };
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
    this.set({ phase: this.state.active ? 'paused' : 'idle', ...(result === 'error' ? { voiceError: this.ports.speechError?.() || 'tts_failed' } : {}) });
    if (result === 'done' && resume && this.valid(g) && this.ports.recognitionAvailable) {
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (this.valid(g)) void this.listen(g); }, 450);
    } else if (this.valid(g) && this.ports.preview) this.set({ phase: 'unavailable' });
  }
  stopPlayback() { this.speechGeneration++; this.ports.stopSpeech(); if (['speaking', 'greeting'].includes(this.state.phase)) this.set({ phase: this.state.active ? 'paused' : 'idle' }); }
  pause() { this.questionGeneration++; this.questionRequest?.abort(); this.stopPlayback(); void this.silenceInput(); if (this.state.active) this.set({ phase: 'paused', transcript: '' }); }
  resume() {
    const g = this.generation;
    const resume = () => {
      if (!this.valid(g) || !['paused', 'unavailable'].includes(this.state.phase)) return;
      this.retries = 0; this.set({ error: '' });
      if (this.ports.recognitionAvailable) { this.set({ phase: 'starting' }); void this.listen(g); }
      else this.set({ phase: 'unavailable' });
    };
    // A fast language change/Resume must still wait for wake-word microphone release.
    if (this.sessionStartup) void this.sessionStartup.then(resume); else resume();
  }
  changeLanguage(lang: Language) { if (lang === this.language) return; this.language = lang; this.pause(); }
  stop(background = false) {
    const id = this.state.id, wasActive = this.state.active;
    this.generation++; this.questionGeneration++; this.speechGeneration++; this.publisherGeneration++;
    this.request.abort(); this.questionRequest?.abort(); void this.silenceInput(); this.ports.stopSpeech();
    try { this.publisher?.stop(); } catch { /* Continue every independent cleanup. */ } this.publisher = undefined;
    try { this.capture?.release(); } catch { /* Native resource may already be released. */ } this.capture = undefined;
    this.ports.keepAwake(false);
    this.set({ ...initial, id, startedAt: this.state.startedAt, phase: background ? 'paused' : 'idle' });
    if (wasActive && id && this.ports.streamingAvailable) void this.ports.register('stop', id).catch(() => {});
  }
  dispose() { this.stop(); this.listeners.clear(); }
}
