// Spoken commands that the session handles itself instead of sending them to the assistant as questions:
// SOS ("I need help"), cancel, camera off, camera on, and read it again. English, Arabic and French.
//
// A command must be (almost) the whole sentence, so "can you help me read this sign?" stays a question and
// never starts an SOS by accident. Each SOS still waits 5 seconds and can be cancelled by voice.
import type { Language } from '../shared/types.ts';

export type Command = 'sos' | 'cancel' | 'cameraOff' | 'cameraOn' | 'repeat' | 'call';

// A plain phone call (not an emergency): "call Mom" / "اتصل بأحمد" / "appelle Marie". The last group is the name.
const CALL_EN = /^(please )?call (.{1,40})$/;
const CALL_AR = /^(اتصل|اتصلي|دق|دقي) (ب|بـ|على )?(.{1,40})$/;
const CALL_FR = /^(appelle|appelez) (.{1,40})$/;

// SOS sentences that name who to call; the last group is the name ("Mom", "أحمد", "Marie").
let SOS_CALL_EN: RegExp, SOS_CALL_AR: RegExp, SOS_CALL_FR: RegExp;

// Whole-sentence patterns, checked in this order. Text is lower-cased and stripped of punctuation first.
const PATTERNS: [Command, RegExp][] = [
  ['sos', /^(please )?(sos|s o s|help|help me|i need help|i need help now|emergency|call for help|call help)( please| now)?$/],
  ['sos', /^(ساعدني|ساعدوني|النجدة|نجدة|بدي مساعدة|بدي مساعده|أحتاج مساعدة|احتاج مساعدة|احتاج مساعده)( الآن| هلق)?$/],
  ['sos', /^(au secours|à l'aide|a l'aide|aidez moi|aidez-moi|aide moi|aide-moi|j'ai besoin d'aide|urgence)( s'il vous plaît)?$/],
  // "I need help, call Mom" / "ساعدني اتصل بأحمد" / "au secours appelle Marie": an SOS that calls that contact.
  ['sos', SOS_CALL_EN = /^(please )?(i need help|help me|help|sos|emergency)( now)? (and )?call (.{1,40})$/],
  ['sos', SOS_CALL_AR = /^(ساعدني|ساعدوني|النجدة|بدي مساعدة|أحتاج مساعدة|احتاج مساعدة) (و)?(اتصل|اتصلي|دق|دقي) (ب|بـ)?(.{1,40})$/],
  ['sos', SOS_CALL_FR = /^(au secours|aidez moi|aidez-moi|aide moi|aide-moi|à l'aide|j'ai besoin d'aide) (et )?(appelle|appelez) (.{1,40})$/],
  ['cancel', /^(cancel|cancel it|stop|no|don't|never mind|nevermind|false alarm|i'm okay|i'm ok|im ok)$/],
  ['cancel', /^(إلغاء|الغاء|ألغي|الغي|لا|وقف|توقف|أنا بخير|انا بخير|ما في شي)$/],
  ['cancel', /^(annule|annuler|non|stop|arrête|ça va|fausse alerte)$/],
  ['cameraOff', /^((turn |switch )?(the )?camera off|(turn|switch) off (the )?camera|(pause|stop|close) (the )?camera)( please)?$/],
  ['cameraOff', /^((أطفئ|اطفئ|اطفي|سكّر|سكر|وقّف|وقف) الكاميرا|الكاميرا (off|مطفية))$/],
  ['cameraOff', /^((éteins|eteins|coupe|arrête|ferme) la caméra|caméra off)$/],
  ['cameraOn', /^((turn |switch )?(the )?camera on|(turn|switch) on (the )?camera|(start|resume|open) (the )?camera)( please)?$/],
  ['cameraOn', /^((شغّل|شغل|افتح|ارجع شغل) الكاميرا|الكاميرا on)$/],
  ['cameraOn', /^((allume|rallume|démarre|ouvre) la caméra|caméra on)$/],
  ['repeat', /^(please )?(read it again|read that again|repeat|repeat it|repeat that|say it again|say that again|again|what did you say|one more time)( please)?$/],
  ['repeat', /^(أعد|اعد|أعيد|اعيد|عيد|عيدها|كرر|كرّر|كررها|شو قلت|مرة ثانية)$/],
  ['repeat', /^(répète|répétez|repete|redis|redis-le|encore une fois|qu'est-ce que tu as dit)$/],
];

// Speech recognition often writes a command word slightly wrong ("camera of", "cameras off", "cancle").
// Short words are fixed from this list; longer ones that are 1-2 letters away from a command word become it.
// Names are left alone unless they are almost exactly a command word.
const NEAR_MISSES: Record<string, string> = {
  of: 'off', 'of.': 'off', aff: 'off', cameras: 'camera', "camera's": 'camera', camra: 'camera', kamera: 'camera',
  col: 'call', kol: 'call', cole: 'call', coll: 'call', cal: 'call', repet: 'repeat', agin: 'again',
};
const COMMAND_WORDS = ['camera', 'cancel', 'repeat', 'again', 'help', 'emergency', 'call'];

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function fixWord(word: string) {
  if (NEAR_MISSES[word]) return NEAR_MISSES[word];
  if (word.length < 4 || !/^[a-z']+$/.test(word)) return word;
  for (const target of COMMAND_WORDS) {
    if (distance(word, target) <= (target.length >= 6 ? 2 : 1)) return target;
  }
  return word;
}

/** Lower-cased, punctuation removed, spaces collapsed, near-miss command words fixed: "Camera of." -> "camera off". */
export function normalize(text: string) {
  const plain = text.toLocaleLowerCase().replace(/[.,!?؟،;:"“”«»]/g, ' ').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  return plain.split(' ').map(fixWord).join(' ');
}

/** The person (or number) in a plain "call Mom", or null when the sentence isn't a call. */
export function callContactName(text: string): string | null {
  const sentence = normalize(text);
  for (const pattern of [CALL_EN, CALL_AR, CALL_FR]) {
    const match = pattern.exec(sentence);
    if (match) return match[match.length - 1].trim() || null;
  }
  return null;
}

/** The person to call in an SOS like "I need help, call Mom" ("Mom"), or null for a plain "I need help". */
export function sosContactName(text: string): string | null {
  const sentence = normalize(text);
  for (const pattern of [SOS_CALL_EN, SOS_CALL_AR, SOS_CALL_FR]) {
    const match = pattern.exec(sentence);
    if (match) return match[match.length - 1].trim() || null;
  }
  return null;
}

/** The command a spoken sentence is, or null when it is an ordinary question. */
export function detectCommand(text: string): Command | null {
  const sentence = normalize(text);
  if (!sentence || sentence.split(' ').length > 10) return null;
  for (const [command, pattern] of PATTERNS) if (pattern.test(sentence)) return command;
  // Checked after SOS, so "call for help" stays an emergency and only "call <someone>" is a plain call.
  if (callContactName(sentence)) return 'call';
  return null;
}

/** Seconds the user has to say "cancel" before an SOS is sent. */
export const SOS_DELAY_SECONDS = 5;

/** What the phone says for each command, in the session's language. */
export const commandCopy: Record<Language, Record<string, string>> = {
  en: {
    sosCountdown: `Sending a help alert in ${SOS_DELAY_SECONDS} seconds. Say cancel to stop.`,
    sosCancelled: 'Cancelled. No alert was sent.',
    sosSentCalling: 'Help alert sent. Calling your emergency contact now, with the flashlight on.',
    sosCallingName: 'Help alert sent. Calling {name} now, with the flashlight on.',
    sosNameNotFound: "I couldn't find {name} in your contacts.",
    callingName: 'Calling {name}.',
    sosSentNoNumber: "Help alert sent to your dashboard. No emergency number is saved, so I can't call.",
    sosFailedCalling: "I couldn't send the alert. Calling your emergency number now.",
    sosFailedNoNumber: "I couldn't send the alert and no emergency number is saved. Please call for help.",
    cameraOff: "Camera off. I'm still listening. Say camera on to start it again.",
    cameraOn: 'Camera on.',
    cameraAlreadyOff: 'The camera is already off.',
    cameraAlreadyOn: 'The camera is already on.',
    cameraOffQuestion: 'The camera is off. Say camera on first.',
    nothingToRepeat: "There's no answer to repeat yet.",
    pausedLabel: 'Camera paused. Say "camera on" to start it again.',
    sosLabel: 'Help alert: say "cancel" to stop it.',
    sosSentLabel: 'Help alert sent.',
    chooseContact: 'Choose emergency contact',
    contactSaved: 'Emergency contact saved.',
    contactNone: 'No emergency contact yet. An SOS still alerts the dashboard, but nobody is called.',
    contactNoNumber: 'That contact has no phone number.',
  },
  ar: {
    sosCountdown: `سأرسل تنبيه طلب مساعدة بعد ${SOS_DELAY_SECONDS} ثوانٍ. قل إلغاء للإيقاف.`,
    sosCancelled: 'تم الإلغاء. لم يُرسل أي تنبيه.',
    sosSentCalling: 'أُرسل تنبيه المساعدة. أتصل الآن بجهة اتصال الطوارئ، والضوء مضاء.',
    sosCallingName: 'أُرسل تنبيه المساعدة. أتصل الآن بـ{name}، والضوء مضاء.',
    sosNameNotFound: 'لم أجد {name} في جهات اتصالك.',
    callingName: 'أتصل بـ{name}.',
    sosSentNoNumber: 'أُرسل تنبيه المساعدة إلى لوحة المتابعة. لا يوجد رقم طوارئ محفوظ، لذلك لا يمكنني الاتصال.',
    sosFailedCalling: 'لم أستطع إرسال التنبيه. أتصل الآن برقم الطوارئ.',
    sosFailedNoNumber: 'لم أستطع إرسال التنبيه ولا يوجد رقم طوارئ محفوظ. اطلب المساعدة من فضلك.',
    cameraOff: 'أُطفئت الكاميرا. ما زلت أستمع. قل شغّل الكاميرا لتشغيلها مجددًا.',
    cameraOn: 'الكاميرا تعمل.',
    cameraAlreadyOff: 'الكاميرا مطفأة أصلًا.',
    cameraAlreadyOn: 'الكاميرا تعمل أصلًا.',
    cameraOffQuestion: 'الكاميرا مطفأة. قل شغّل الكاميرا أولًا.',
    nothingToRepeat: 'لا توجد إجابة لإعادتها بعد.',
    pausedLabel: 'الكاميرا متوقفة. قل «شغّل الكاميرا» لتشغيلها.',
    sosLabel: 'تنبيه مساعدة: قل «إلغاء» لإيقافه.',
    sosSentLabel: 'أُرسل تنبيه المساعدة.',
    chooseContact: 'اختر جهة اتصال للطوارئ',
    contactSaved: 'حُفظت جهة اتصال الطوارئ.',
    contactNone: 'لا توجد جهة اتصال للطوارئ بعد. طلب المساعدة يصل إلى لوحة المتابعة، لكن لن يتم الاتصال بأحد.',
    contactNoNumber: 'لا يوجد رقم هاتف لجهة الاتصال هذه.',
  },
  fr: {
    sosCountdown: `J'envoie une alerte d'aide dans ${SOS_DELAY_SECONDS} secondes. Dites annuler pour arrêter.`,
    sosCancelled: "Annulé. Aucune alerte n'a été envoyée.",
    sosSentCalling: "Alerte d'aide envoyée. J'appelle votre contact d'urgence, avec la lampe allumée.",
    sosCallingName: "Alerte d'aide envoyée. J'appelle {name}, avec la lampe allumée.",
    sosNameNotFound: "Je n'ai pas trouvé {name} dans vos contacts.",
    callingName: "J'appelle {name}.",
    sosSentNoNumber: "Alerte d'aide envoyée au tableau de bord. Aucun numéro d'urgence n'est enregistré, je ne peux pas appeler.",
    sosFailedCalling: "Je n'ai pas pu envoyer l'alerte. J'appelle votre numéro d'urgence.",
    sosFailedNoNumber: "Je n'ai pas pu envoyer l'alerte et aucun numéro d'urgence n'est enregistré. Appelez à l'aide, s'il vous plaît.",
    cameraOff: "Caméra éteinte. J'écoute toujours. Dites allume la caméra pour la rallumer.",
    cameraOn: 'Caméra allumée.',
    cameraAlreadyOff: 'La caméra est déjà éteinte.',
    cameraAlreadyOn: 'La caméra est déjà allumée.',
    cameraOffQuestion: "La caméra est éteinte. Dites d'abord allume la caméra.",
    nothingToRepeat: "Il n'y a pas encore de réponse à répéter.",
    pausedLabel: 'Caméra en pause. Dites « allume la caméra » pour la rallumer.',
    sosLabel: "Alerte d'aide : dites « annuler » pour l'arrêter.",
    sosSentLabel: "Alerte d'aide envoyée.",
    chooseContact: "Choisir le contact d'urgence",
    contactSaved: "Contact d'urgence enregistré.",
    contactNone: "Aucun contact d'urgence. Une alerte SOS arrive au tableau de bord, mais personne n'est appelé.",
    contactNoNumber: "Ce contact n'a pas de numéro de téléphone.",
  },
};
