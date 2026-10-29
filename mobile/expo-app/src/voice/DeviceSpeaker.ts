import * as Speech from 'expo-speech';
import { selectLocale, words } from '../i18n/words';
import type { Language } from '../types';
export class DeviceSpeaker {
  private generation = 0;
  private finish: (() => void) | undefined;
  async speak(text: string, language: Language, onStart: () => void, onError: (message: string) => void) {
    const token = ++this.generation;
    this.finish?.();
    await Speech.stop();
    if (token !== this.generation) return;
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (token !== this.generation) return;
      const locale = selectLocale(voices.map(voice => voice.language), language);
      const voice = voices.find(voice => voice.language === locale);
      if (!voice) { onError(words[language].speechMissing); return; }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timeout); if (this.finish === done) this.finish = undefined; resolve(); };
        this.finish = done;
        const timeout = setTimeout(() => {
          if (token === this.generation) { onError(words[language].speechError); void Speech.stop(); }
          done();
        }, 90000);
        try {
          Speech.speak(text, { language: locale, voice: voice.identifier, rate: 0.95,
            useApplicationAudioSession: false,
            onStart: () => { if (token === this.generation) onStart(); },
            onDone: done, onStopped: done,
            onError: () => { if (token === this.generation) onError(words[language].speechError); done(); },
          });
        } catch { onError(words[language].speechError); done(); }
      });
    } catch { if (token === this.generation) onError(words[language].speechError); }
  }
  stop() { ++this.generation; this.finish?.(); this.finish = undefined; void Speech.stop().catch(() => {}); }
}
