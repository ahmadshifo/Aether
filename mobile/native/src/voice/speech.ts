import * as Speech from 'expo-speech';
import type { Language } from '../shared/types';
// Reading speed: 1 is the phone's normal speed. "Speak slower/faster" moves it by one step within these limits.
export const SPEECH_RATE = { normal: 0.95, step: 0.15, min: 0.5, max: 1.55 };

export class SpeechOwner {
  private generation = 0;
  rate = SPEECH_RATE.normal;
  /** One step slower (-1) or faster (+1). Returns the new rate, or null when already at the limit. */
  changeRate(direction: -1 | 1): number | null {
    const next = Math.round((this.rate + direction * SPEECH_RATE.step) * 100) / 100;
    if (next < SPEECH_RATE.min || next > SPEECH_RATE.max) return null;
    this.rate = next;
    return next;
  }
  private finish?: (result: 'done' | 'error' | 'cancelled') => void;
  private stopping = Promise.resolve();
  stop = () => {
    this.generation++; this.finish?.('cancelled'); this.finish = undefined;
    this.stopping = Speech.stop().catch(() => {});
  };
  speak = async (text: string, language: Language, onStart: () => void): Promise<'done' | 'error' | 'cancelled'> => {
    this.stop(); const g = this.generation;
    return new Promise(resolve => {
      let finished = false;
      const finish = (value: 'done' | 'error' | 'cancelled') => { if (finished) return; finished = true; clearTimeout(timer); if (this.finish === finish) this.finish = undefined; resolve(value); };
      const timer = setTimeout(() => { finish('error'); this.stop(); }, 60000);
      this.finish = finish;
      void Promise.all([this.stopping, Speech.getAvailableVoicesAsync()]).then(([, voices]) => {
        if (finished || g !== this.generation) { finish('cancelled'); return; }
        const voice = voices.find(v => v.language.toLowerCase().startsWith(language));
        if (!voice) { finish('error'); return; }
        Speech.speak(text, { language: voice.language, voice: voice.identifier, rate: this.rate,
          useApplicationAudioSession: false, onStart: () => { if (g === this.generation) onStart(); },
          onDone: () => finish('done'), onStopped: () => finish('cancelled'), onError: () => finish('error') });
      }).catch(() => finish('error'));
    });
  };
}
