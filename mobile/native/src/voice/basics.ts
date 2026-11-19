// Basic questions the phone answers by itself, without the server or the AI, so they work with no internet:
// the battery, the internet and server connection, the time and the date. English, Arabic and French.
// "Where am I" (placeAnswer) also runs on the phone, but turning GPS into a street name needs the internet.
import type { Language } from '../shared/types.ts';

export type Basic = 'battery' | 'internet' | 'time' | 'date';
export type BatteryInfo = { level: number; charging: boolean } | null;
export type ConnectionInfo = { internet: boolean; server: boolean; video: boolean };
/** Where the user is, from src/platform/whereAmI.ts: the address parts, or why there are none. */
export type Place =
  | { status: 'found'; street?: string; number?: string; name?: string; district?: string; city?: string }
  | { status: 'permission' | 'servicesOff' | 'unavailable' | 'noAddress' | 'failed' };

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
    place: 'You are {place}.', street: 'on {street}', near: 'near {name}', area: 'in {area}',
    placePermission: 'I need location access to tell you where you are. Please allow it for Aether in your phone settings.',
    placeServicesOff: "Your phone's location is turned off. Turn on Location in your phone settings and ask again.",
    placeUnavailable: "This version of the app can't use location. Please install the new Aether build.",
    placeNoAddress: 'I found your position, but not the street name. Check the internet and ask again.',
    placeFailed: "I couldn't find your location right now. Please ask again in a moment.",
  },
  ar: {
    battery: 'البطارية {n} بالمئة.', charging: 'البطارية {n} بالمئة وهي تشحن.',
    batteryUnknown: 'لا يمكنني قراءة البطارية في هذه النسخة من التطبيق.',
    allGood: 'أنت متصل بالإنترنت وبإيثر.',
    noVideo: 'أنت متصل بالإنترنت وبإيثر، لكن فيديو الكاميرا لا يصل الآن.',
    noServer: 'أنت متصل بالإنترنت، لكن لا يمكنني الوصول إلى خادم إيثر، لذلك لا أستطيع الإجابة عن أسئلة الكاميرا.',
    noInternet: 'لا يوجد اتصال بالإنترنت الآن. ما زال بإمكاني إخبارك بالوقت والتاريخ والبطارية.',
    time: 'الساعة {time}.', date: 'اليوم {date}.',
    place: 'أنت {place}.', street: 'في {street}', near: 'قرب {name}', area: 'في {area}',
    placePermission: 'أحتاج إذن الموقع لأخبرك أين أنت. اسمح به لإيثر في إعدادات الهاتف.',
    placeServicesOff: 'الموقع مطفأ في هاتفك. شغّل الموقع من الإعدادات واسأل مرة أخرى.',
    placeUnavailable: 'هذه النسخة من التطبيق لا تستطيع استخدام الموقع. ثبّت نسخة إيثر الجديدة.',
    placeNoAddress: 'وجدتُ مكانك، لكن ليس اسم الشارع. تحقق من الإنترنت واسأل مرة أخرى.',
    placeFailed: 'لم أتمكن من معرفة موقعك الآن. اسأل مرة أخرى بعد قليل.',
  },
  fr: {
    battery: 'La batterie est à {n} pour cent.', charging: 'La batterie est à {n} pour cent et en charge.',
    batteryUnknown: "Je ne peux pas lire la batterie dans cette version de l'application.",
    allGood: 'Vous êtes connecté à internet et à Aether.',
    noVideo: "Vous êtes connecté à internet et à Aether, mais la vidéo de la caméra n'arrive pas en ce moment.",
    noServer: "Vous êtes connecté à internet, mais je n'arrive pas à joindre le serveur Aether, donc je ne peux pas répondre aux questions sur la caméra.",
    noInternet: "Il n'y a pas de connexion internet. Je peux quand même vous dire l'heure, la date et la batterie.",
    time: 'Il est {time}.', date: "Aujourd'hui, nous sommes le {date}.",
    place: 'Vous êtes {place}.', street: 'sur {street}', near: 'près de {name}', area: 'à {area}',
    placePermission: "J'ai besoin de l'accès à la position pour vous dire où vous êtes. Autorisez-le pour Aether dans les réglages du téléphone.",
    placeServicesOff: 'La localisation du téléphone est désactivée. Activez-la dans les réglages et redemandez.',
    placeUnavailable: "Cette version de l'application ne peut pas utiliser la position. Installez la nouvelle version d'Aether.",
    placeNoAddress: "J'ai trouvé votre position, mais pas le nom de la rue. Vérifiez internet et redemandez.",
    placeFailed: "Je n'ai pas pu trouver votre position. Redemandez dans un instant.",
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

/** "Where am I": "You are on 12 Hamra Street, near AUB, in Ras Beirut, Beirut." Only the parts the phone found. */
export function placeAnswer(language: Language, place: Place): string {
  const text = copy[language];
  if (place.status !== 'found') {
    return { permission: text.placePermission, servicesOff: text.placeServicesOff, unavailable: text.placeUnavailable,
      noAddress: text.placeNoAddress, failed: text.placeFailed }[place.status];
  }
  const same = (a?: string, b?: string) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const street = place.street ? [place.number, place.street].filter(Boolean).join(' ') : '';
  // The place name is often just the house number or the street again; only a real name ("AUB") is said.
  const name = place.name && !same(place.name, place.street) && !same(place.name, street) && !/^[\d\s\-/]+$/.test(place.name) ? place.name : '';
  const area = [place.district, place.city]
    .filter((value, index, all) => value && !same(value, place.street) && all.findIndex(other => same(other, value)) === index).join(', ');
  const parts = [street && text.street.replace('{street}', street), name && text.near.replace('{name}', name),
    area && text.area.replace('{area}', area)].filter(Boolean);
  if (!parts.length) return text.placeNoAddress;
  return text.place.replace('{place}', parts.join(language === 'ar' ? '، ' : ', '));
}
