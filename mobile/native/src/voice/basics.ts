// Basic questions the phone answers by itself, without the server or the AI, so they work with no internet:
// the battery, the internet and server connection, the time and the date. English, Arabic and French.
import type { Language } from '../shared/types.ts';

export type Basic = 'battery' | 'internet' | 'time' | 'date';
export type BatteryInfo = { level: number; charging: boolean } | null;
export type ConnectionInfo = { internet: boolean; server: boolean; video: boolean };

const LOCALE: Record<Language, string> = { en: 'en-GB', ar: 'ar-LB', fr: 'fr-FR' };

const copy = {
  en: {
    battery: 'Your battery is at {n} percent.', charging: 'Your battery is at {n} percent and charging.',
    batteryUnknown: "I can't read the battery in this version of the app.",
    allGood: "You're connected to the internet and to Aether.",
    noVideo: "You're connected to the internet and to Aether, but the camera video isn't reaching it right now.",
    noServer: "You're connected to the internet, but I can't reach the Aether server, so I can't answer camera questions.",
    noInternet: "There's no internet connection right now. I can still tell you the time, the date and the battery.",
    time: 'It is {time}.', date: 'Today is {date}.',
  },
  ar: {
    battery: 'البطارية {n} بالمئة.', charging: 'البطارية {n} بالمئة وهي تشحن.',
    batteryUnknown: 'لا يمكنني قراءة البطارية في هذه النسخة من التطبيق.',
    allGood: 'أنت متصل بالإنترنت وبإيثر.',
    noVideo: 'أنت متصل بالإنترنت وبإيثر، لكن فيديو الكاميرا لا يصل الآن.',
    noServer: 'أنت متصل بالإنترنت، لكن لا يمكنني الوصول إلى خادم إيثر، لذلك لا أستطيع الإجابة عن أسئلة الكاميرا.',
    noInternet: 'لا يوجد اتصال بالإنترنت الآن. ما زال بإمكاني إخبارك بالوقت والتاريخ والبطارية.',
    time: 'الساعة {time}.', date: 'اليوم {date}.',
  },
  fr: {
    battery: 'La batterie est à {n} pour cent.', charging: 'La batterie est à {n} pour cent et en charge.',
    batteryUnknown: "Je ne peux pas lire la batterie dans cette version de l'application.",
    allGood: 'Vous êtes connecté à internet et à Aether.',
    noVideo: "Vous êtes connecté à internet et à Aether, mais la vidéo de la caméra n'arrive pas en ce moment.",
    noServer: "Vous êtes connecté à internet, mais je n'arrive pas à joindre le serveur Aether, donc je ne peux pas répondre aux questions sur la caméra.",
    noInternet: "Il n'y a pas de connexion internet. Je peux quand même vous dire l'heure, la date et la batterie.",
    time: 'Il est {time}.', date: "Aujourd'hui, nous sommes le {date}.",
  },
} satisfies Record<Language, Record<string, string>>;

export function batteryAnswer(language: Language, battery: BatteryInfo): string {
  const text = copy[language];
  if (!battery || !(battery.level >= 0 && battery.level <= 1)) return text.batteryUnknown;
  return (battery.charging ? text.charging : text.battery).replace('{n}', String(Math.round(battery.level * 100)));
}

/** video: whether the camera's video link is connected (only asked about during a session with the camera on). */
export function connectionAnswer(language: Language, info: ConnectionInfo): string {
  const text = copy[language];
  if (!info.internet && !info.server) return text.noInternet;
  if (!info.server) return text.noServer;
  return info.video ? text.allGood : text.noVideo;
}

export function timeAnswer(language: Language, now: Date): string {
  const time = now.toLocaleTimeString(LOCALE[language], { hour: 'numeric', minute: '2-digit', hour12: language !== 'fr' });
  return copy[language].time.replace('{time}', time);
}

export function dateAnswer(language: Language, now: Date): string {
  const date = now.toLocaleDateString(LOCALE[language], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return copy[language].date.replace('{date}', date);
}
