import * as Speech from 'expo-speech';
import type { Language } from '../shared/types';
export class SpeechOwner {
  private generation = 0;
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
        Speech.speak(text, { language: voice.language, voice: voice.identifier, rate: 0.95,
          useApplicationAudioSession: false, onStart: () => { if (g === this.generation) onStart(); },
          onDone: () => finish('done'), onStopped: () => finish('cancelled'), onError: () => finish('error') });
      }).catch(() => finish('error'));
    });
  };
}
