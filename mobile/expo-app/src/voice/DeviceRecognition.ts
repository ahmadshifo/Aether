import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { selectLocale, words } from '../i18n/words';
import type { Language, Phase } from '../types';
import { Lifetime } from '../session/Lifetime';
let drain: Promise<void> = Promise.resolve();
/** Global OS recognizers emit untagged events; drain the previous run before attaching another. */
export class DeviceRecognition {
  private run: Lifetime | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private emptyRuns = 0;
  private disposed = false;
  private locale = '';
  constructor(private language: Language, private phase: (phase: Phase) => void,
    private transcript: (text: string) => void, private notice: (message: string) => void,
    private question: (text: string) => Promise<void>, private module: typeof ExpoSpeechRecognitionModule | null) {}

  async start() {
    const t = words[this.language];
    const module = this.module;
    if (!module) { this.notice(t.voiceGo); return; }
    if (!module.isRecognitionAvailable()) { this.notice(t.voiceMissing); return; }
    const permission = await module.requestPermissionsAsync();
    if (this.disposed) return;
    if (!permission.granted) { this.notice(t.voiceDenied); return; }
    const offline = process.env.EXPO_PUBLIC_SPEECH_ON_DEVICE_ONLY === 'true';
    if (offline && !module.supportsOnDeviceRecognition()) { this.notice(t.offlineMissing); return; }
    let locales: Awaited<ReturnType<typeof module.getSupportedLocales>> | undefined;
    try { locales = await module.getSupportedLocales({}); } catch { /* Older Android services cannot enumerate. */ }
    if (this.disposed) return;
    const available = offline ? locales?.installedLocales : locales?.locales;
    this.locale = available?.length ? selectLocale(available, this.language) ?? ''
      : offline ? '' : this.language === 'ar' ? 'ar-LB' : 'en-US';
    if (!this.locale) { this.notice(offline ? t.offlineMissing : t.localeMissing); return; }
    await this.listen();
  }
  async listen() {
    await drain;
    if (this.disposed || this.run || !this.module || !this.locale) return;
    const module = this.module;
    // A missing end event must not allow a second recognizer to attach to stale OS events.
    try {
      if (await module.getStateAsync() !== 'inactive') { this.notice(words[this.language].voiceError); return; }
    } catch { this.notice(words[this.language].voiceError); return; }
    if (this.disposed || this.run) return;
    const run = new Lifetime(); this.run = run;
    const t = words[this.language];
    let final = ''; let failed = false;
    this.notice(t.startingVoice);
    const on = <K extends 'start' | 'result' | 'error' | 'end'>(
      event: K, listener: Parameters<typeof module.addListener<K>>[1],
    ) => { const subscription = module.addListener(event, listener); run.own(() => subscription.remove()); };
    on('start', () => { if (run.active) { this.notice(''); this.phase('listening'); } });
    on('result', event => {
      if (!run.active) return;
      const text = event.results[0]?.transcript.trim() ?? '';
      if (text) { this.transcript(text); this.phase('hearing'); }
      if (event.isFinal && text) final = `${final} ${text}`.trim();
    });
    on('error', event => {
      if (!run.active || event.error === 'aborted') return;
      if (event.error !== 'no-speech') {
        failed = true;
        this.notice(event.error === 'language-not-supported' ? t.localeMissing : t.voiceError);
        this.phase('ready');
      }
    });
    on('end', () => {
      if (!run.active) return;
      run.stop(); this.run = null;
      this.phase('ready');
      if (failed || this.disposed) return;
      if (final) {
        this.emptyRuns = 0;
        void this.question(final).then(() => this.listen()).catch(() => {
          if (!this.disposed) { this.notice(t.voiceError); this.phase('ready'); }
        });
      } else if (++this.emptyRuns < 3) {
        this.retry = setTimeout(() => { this.retry = undefined; void this.listen(); }, 500);
      } else this.notice(t.voiceEnded);
    });
    try {
      module.start({ lang: this.locale, interimResults: true, continuous: false,
        requiresOnDeviceRecognition: process.env.EXPO_PUBLIC_SPEECH_ON_DEVICE_ONLY === 'true',
        addsPunctuation: false, recordingOptions: { persist: false } });
    } catch {
      run.stop(); this.run = null; this.notice(t.voiceError); this.phase('ready');
    }
  }
  pause() {
    clearTimeout(this.retry); this.retry = undefined;
    const module = this.module;
    if (!this.run || !module) return;
    this.run.stop(); this.run = null;
    drain = new Promise<void>(resolve => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true; clearTimeout(timeout); subscription.remove(); resolve();
      };
      const subscription = module.addListener('end', done);
      const timeout = setTimeout(done, 1500);
      try { module.abort(); } catch { done(); }
    });
  }
  stop() { this.disposed = true; this.pause(); }
}
