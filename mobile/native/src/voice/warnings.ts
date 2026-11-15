// Spoken warnings during a session, so a blind user is never left without the assistant without knowing:
// low battery (once at 20 %, once at 10 %) and the video connection dropping and coming back.
// The rules live here (no phone APIs), so they can be tested; the session controller speaks them.
import type { Language } from '../shared/types.ts';
import type { Transport } from '../streaming/whip.ts';

export type Warning = 'battery20' | 'battery10' | 'connectionLost' | 'connectionBack' | 'connectionFailed';

export const warningCopy: Record<Language, Record<Warning, string>> = {
  en: {
    battery20: 'Battery at 20 percent.',
    battery10: 'Battery at 10 percent. The assistant will stop soon, please charge the phone.',
    connectionLost: 'I lost the connection. Trying again.',
    connectionBack: 'Connected again.',
    connectionFailed: "I can't reach the server right now. Questions may not work until the connection is back.",
  },
  ar: {
    battery20: 'البطارية 20 بالمئة.',
    battery10: 'البطارية 10 بالمئة. سيتوقف المساعد قريبًا، اشحن الهاتف من فضلك.',
    connectionLost: 'انقطع الاتصال. أحاول مرة أخرى.',
    connectionBack: 'عاد الاتصال.',
    connectionFailed: 'لا يمكنني الوصول إلى الخادم الآن. قد لا تعمل الأسئلة حتى يعود الاتصال.',
  },
  fr: {
    battery20: 'Batterie à 20 pour cent.',
    battery10: "Batterie à 10 pour cent. L'assistant va bientôt s'arrêter, chargez le téléphone.",
    connectionLost: "J'ai perdu la connexion. Nouvel essai.",
    connectionBack: 'Connexion rétablie.',
    connectionFailed: "Je n'arrive pas à joindre le serveur. Les questions risquent de ne pas marcher tant que la connexion n'est pas revenue.",
  },
};

/**
 * The battery warning to say now, or null. `spoken` remembers what was said this session, so each level is
 * said once; charging back above 25 % lets the warnings come again later.
 */
export function batteryWarning(level: number, charging: boolean, spoken: Set<Warning>): Warning | null {
  if (!(level >= 0 && level <= 1)) return null;  // unknown level (emulator, or the reading failed)
  if (level > 0.25) { spoken.delete('battery20'); spoken.delete('battery10'); return null; }
  if (charging) return null;
  if (level <= 0.1 && !spoken.has('battery10')) { spoken.add('battery10'); spoken.add('battery20'); return 'battery10'; }
  if (level <= 0.2 && !spoken.has('battery20')) { spoken.add('battery20'); return 'battery20'; }
  return null;
}

/**
 * The connection warning when the video link changes, or null. `connected` is whether it has been connected
 * since the session (or the camera) started; a link that never connected gets "connectionFailed" once.
 */
export function connectionWarning(previous: Transport, next: Transport, connected: boolean, lostSaid: boolean): Warning | null {
  if (previous === next) return null;
  if (next === 'connected') return lostSaid ? 'connectionBack' : null;
  if (lostSaid) return null;
  if ((next === 'reconnecting' || next === 'failed') && connected) return 'connectionLost';
  if (next === 'failed' && !connected) return 'connectionFailed';
  return null;
}
