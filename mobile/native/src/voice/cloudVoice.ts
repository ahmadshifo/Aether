import type { Language } from '../shared/types';
import type { RecognitionEvents } from '../session/controller';
import { loadAudio } from '../platform/capabilities';
import { duringPermission } from '../platform/permissions';
import type { VoiceApi } from './apiClient';
import { UtteranceGate } from './utterance';

const files = () => require('expo-file-system') as typeof import('expo-file-system');
const discard = (uri?: string | null) => { if (uri) { try { const file = new (files().File)(uri); if (file.exists) file.delete(); } catch { /* OS cache cleanup is a final fallback. */ } } };

export class CloudVoice {
  private api: VoiceApi;
  private playback?: () => void;
  private synthesis?: AbortController;
  private generation = 0;
  error = '';
  constructor(api: VoiceApi) { this.api = api; }

  prepare = async (signal: AbortSignal) => {
    const audio = loadAudio();
    await this.api.check(signal);
    if (signal.aborted) throw Error('cancelled');
    const permission = await duringPermission(() => audio.requestRecordingPermissionsAsync(), signal);
    if (!permission.granted) throw Error('recognition_denied');
  };

  recognize = async (language: Language, events: RecognitionEvents, signal: AbortSignal): Promise<() => Promise<void>> => {
    const audio = loadAudio();
    if (signal.aborted) return async () => {};
    const recorder = new audio.AudioModule.AudioRecorder({ ...audio.RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true });
    let interval: ReturnType<typeof setInterval> | undefined, stopped = false, submitting = false, uri: string | null = null;
    let release: Promise<void> | undefined, finishing: Promise<void> | undefined;
    const request = new AbortController();
    const valid = () => !stopped && !signal.aborted;
    const finishRecording = () => finishing ??= (async () => {
      try { if (recorder.isRecording) await recorder.stop(); }
      finally { uri ??= recorder.uri; }
    })();
    const cleanup = () => {
      stopped = true; request.abort(); clearInterval(interval); signal.removeEventListener('abort', abort);
      release ??= (async () => {
        try { await finishRecording(); } catch { /* Interrupted by the OS. */ }
        try { recorder.release(); } catch { /* Already released. */ }
        discard(uri);
        await audio.setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      })();
      return release;
    };
    const abort = () => { void cleanup(); };
    // Install the abort listener only after preparation; a late prepare must also release its file.
    try {
      await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (!valid()) { await cleanup(); return cleanup; }
      await recorder.prepareToRecordAsync();
      if (!valid()) { await cleanup(); return cleanup; }
      signal.addEventListener('abort', abort, { once: true });
      recorder.record(); events.start();
      const started = Date.now(), gate = new UtteranceGate();
      const submit = async (decision: 'send' | 'silence' | 'unavailable') => {
        if (!valid() || submitting) return;
        submitting = true; clearInterval(interval);
        try {
          await finishRecording();
          if (!valid()) return;
          if (decision !== 'send') { events.error(decision === 'silence' ? 'no-speech' : 'voice_recording'); return; }
          if (!uri) throw Error('voice_recording');
          events.processing?.();
          const bytes = await new (files().File)(uri).bytes();
          const text = await this.api.transcribe(bytes, language, request.signal);
          if (valid()) { if (text) { events.result(text, true); events.end(); } else events.error('no-speech'); }
        } catch (error) { if (valid()) events.error(error instanceof Error && error.message.startsWith('voice_') ? error.message : 'voice_unavailable'); }
        finally { await cleanup(); }
      };
      interval = setInterval(() => {
        if (!valid() || submitting) return;
        try {
          const status = recorder.getStatus();
          if (!status.isRecording || status.mediaServicesDidReset) { void submit('unavailable'); return; }
          const decision = gate.sample(Date.now() - started, status.metering);
          if (decision !== 'wait') void submit(decision);
        } catch { void submit('unavailable'); }
      }, 100);
      return cleanup;
    } catch (error) { await cleanup(); throw error; }
  };

  stop = () => {
    this.generation++; this.synthesis?.abort(); this.synthesis = undefined;
    this.playback?.(); this.playback = undefined;
  };
  speak = async (text: string, language: Language, onStart: () => void): Promise<'done' | 'error' | 'cancelled'> => {
    this.stop(); this.error = ''; const generation = this.generation, request = new AbortController(); this.synthesis = request;
    let uri: string | undefined;
    try {
      const audio = loadAudio();
      const bytes = await this.api.synthesize(text, language, request.signal);
      if (request.signal.aborted || generation !== this.generation) return 'cancelled';
      const { File, Paths } = files(), file = new File(Paths.cache, `aether-voice-${Date.now()}-${generation}.mp3`);
      uri = file.uri; file.write(bytes);
      await audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (request.signal.aborted || generation !== this.generation) return 'cancelled';
      return await new Promise(resolve => {
        const player = audio.createAudioPlayer(uri!, { updateInterval: 100 });
        let finished = false, began = false;
        const finish = (result: 'done' | 'error' | 'cancelled') => {
          if (finished) return; finished = true; clearTimeout(timer); subscription.remove();
          try { player.pause(); player.remove(); } finally { if (this.playback === cancel) this.playback = undefined; resolve(result); }
        };
        const cancel = () => finish('cancelled');
        const timer = setTimeout(() => finish('error'), 180000);
        const subscription = player.addListener('playbackStatusUpdate', status => {
          if (status.playing && !began) { began = true; onStart(); }
          if (status.didJustFinish) finish('done');
          else if (status.playbackState === 'error' || status.mediaServicesDidReset) finish('error');
        });
        this.playback = cancel;
        try { player.play(); } catch { finish('error'); }
      });
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) return 'cancelled';
      this.error = error instanceof Error && error.message.startsWith('voice_') ? error.message : 'voice_unavailable'; return 'error';
    } finally { discard(uri); if (this.synthesis === request) this.synthesis = undefined; }
  };
}
