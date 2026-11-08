import { monoCopy } from './monoCopy';
import { uiCopy } from './uiCopy';
import { authCopy } from './authCopy';
import { teamCopy } from './teamCopy';
import { frMono, frAuth, frUI, frNative, frTeam } from './french';
import type { Language } from '../shared/types';
export const nativeCopy = {
  en: {
    details: 'Details', openingGreeting: 'Session opened', preview: 'Expo Go preview', native: 'Native development build', native_required: 'Install the development build to use speech recognition and camera streaming.',

    typed: 'Development test · typed question, not microphone recognition', typedLabel: 'Typed test question',
    stopSpeech: 'Stop speech', language_unavailable: 'This device does not report support for the selected speech language. No language was substituted.',
    recognition_denied: 'Microphone or speech recognition is denied or unavailable. Check this app’s permissions in device Settings, then Start again.',
    recognition_failed: 'Speech recognition could not continue. Check the system speech service and connection, then Resume.',
    silence: 'No speech was recognized. Waiting to retry.', camera_denied: 'Camera could not open. Check permission and whether another app is using it. Voice can work independently.',
    tts_failed: 'Could not play speech. Check volume, Silent Mode and installed voices.',
    noSnapshot: 'No photo saved: this native WebRTC camera adapter has no supported frame-capture API. Preview and streaming may still work.',
    osSpeech: 'Speech may need internet. For spoken replies on iPhone, turn off Silent Mode and raise the volume.',
    backend: 'Aether server address', media: 'MediaMTX origin', save: 'Save connection', lan: 'Allow private-LAN development HTTP',
    lanNote: 'Use only your trusted private network, for example your home Wi-Fi.',
    invalid_origin: 'Enter an address such as http://192.168.1.20:8002, with no path, password, query or fragment.',
    https_required: 'Use HTTPS, or explicitly enable development HTTP for a private IP address or .local host.',
    connectionNote: 'Changing the server stops the session and signs you out.',
    reachable: 'Server reachable', signedOut: 'Signed out', authenticated: 'Authenticated', unknown: 'Not checked', checking: 'Checking…',
    backendSetup: 'Use the address of the laptop running the Aether backend, on port 8002.', backend_unavailable: 'Aether server unavailable or unrecognized. Open Connection, then check the address and that the backend is running.',
    signaling: 'Media signaling', signalingReachable: 'Signaling reachable', signalingUnavailable: 'Signaling unverified or unavailable',
    registry: 'Session link', registered: 'Session linked', registry_failed: 'Session link failed',
    transportConnected: 'Stream connected', transportFailed: 'Stream failed · preview only',
    privacy: 'Local History is cached per account and server. Opening History also loads available server answers.',
    retention: 'History shows the last 24 hours. Up to 50 answers are cached on this phone; older answers load from the server. Local cleanup runs on launch and resume.',
    clearBody: 'This removes local copies from this app. Server records are not deleted and may appear again when History reloads.',
    accountNote: 'Signed in to your Aether account on this app.', audioLimits: 'Device speech. Replay and Stop speech are available; pause and duration are unavailable.',
    aloudNote: 'Answers play automatically through device speech. No speed or voice selector is implemented.',
    steps: [ ['Start together', 'Tap Start, or enable “Hey Aether” in Settings and say it while the app is open.'], ['Ask out loud', 'After the greeting, wait for Listening and ask your question.'], ['Listen or read', 'Hear the reply. Tap Answer to read it or replay it.'], ['Stop when you choose', 'Tap Stop session. Leaving the app also stops the camera and microphone.'] ],
    fontFallback: 'Font loading failed; system fonts are in use.', permissionSettings: 'Open device Settings', shareCancelled: 'Sharing cancelled',
    stopped: 'Session stopped', unavailable: 'Unavailable', error: 'Needs attention', pending: 'Pending', off: 'Off',
    emptyConnection: 'Set the laptop origins before signing in.',
  },
  ar: {
    details: 'التفاصيل', openingGreeting: 'بدأت الجلسة', preview: 'معاينة Expo Go', native: 'نسخة تطوير أصلية', native_required: 'ثبّت نسخة التطوير لاستخدام التعرّف على الكلام وبث الكاميرا.',

    typed: 'اختبار تطوير · سؤال مكتوب وليس تعرّفًا من الميكروفون', typedLabel: 'سؤال الاختبار المكتوب',
    stopSpeech: 'إيقاف النطق', language_unavailable: 'لا يبلّغ هذا الجهاز عن دعم لغة الكلام المحددة. لم تُستبدل اللغة بلغة أخرى.',
    recognition_denied: 'الميكروفون أو التعرّف على الكلام مرفوض أو غير متاح. تحقّق من أذونات التطبيق في إعدادات الجهاز ثم ابدأ مجددًا.',
    recognition_failed: 'تعذّرت متابعة التعرّف على الكلام. تحقّق من خدمة الكلام والاتصال ثم استأنف.',
    silence: 'لم يُتعرّف على كلام. بانتظار إعادة المحاولة.', camera_denied: 'تعذّر فتح الكاميرا. تحقّق من الإذن ومن استخدامها في تطبيق آخر. يمكن للصوت العمل بشكل مستقل.',
    tts_failed: 'تعذّر تشغيل النطق. تحقّق من مستوى الصوت والوضع الصامت والأصوات المثبتة.',
    noSnapshot: 'لا توجد صورة محفوظة: لا توفر كاميرا WebRTC الأصلية واجهة مدعومة لالتقاط إطار. قد تعمل المعاينة والبث رغم ذلك.',
    osSpeech: 'قد يحتاج التعرّف على الكلام إلى الإنترنت. لسماع الردود على iPhone، أوقف الوضع الصامت وارفع مستوى الصوت.',
    backend: 'عنوان خادم Aether', media: 'عنوان MediaMTX', save: 'حفظ الاتصال', lan: 'السماح بـ HTTP للتطوير على شبكة محلية خاصة',
    lanNote: 'استخدم شبكة خاصة موثوقة فقط، مثل شبكة Wi-Fi المنزلية.',
    invalid_origin: 'أدخل عنوانًا مثل http://192.168.1.20:8002 دون مسار أو كلمة مرور أو استعلام أو جزء إضافي.',
    https_required: 'استخدم HTTPS أو فعّل HTTP للتطوير صراحةً لعنوان IP خاص أو مضيف ينتهي بـ .local.',
    connectionNote: 'تغيير الخادم يوقف الجلسة ويسجّل خروجك.',
    reachable: 'الخادم قابل للوصول', signedOut: 'غير مسجّل الدخول', authenticated: 'تم التحقق من الحساب', unknown: 'لم يُفحص', checking: 'جارٍ الفحص…',
    backendSetup: 'استخدم عنوان الحاسوب الذي يشغّل خادم Aether، على المنفذ 8002.', backend_unavailable: 'خادم Aether غير متاح أو غير معروف. افتح الاتصال ثم تحقّق من العنوان ومن تشغيل الخادم.',
    signaling: 'إشارات البث', signalingReachable: 'الإشارات متاحة', signalingUnavailable: 'الإشارات غير متاحة أو غير متحقق منها',
    registry: 'ربط الجلسة', registered: 'تم ربط الجلسة', registry_failed: 'فشل ربط الجلسة',
    transportConnected: 'البث متصل', transportFailed: 'فشل البث · معاينة فقط',
    privacy: 'تُحفظ نسخة محلية من السجل لكل حساب وخادم. يحمّل فتح السجل أيضًا الإجابات المتاحة على الخادم.',
    retention: 'يعرض السجل آخر ٢٤ ساعة. تُحفظ حتى ٥٠ إجابة على هذا الهاتف، وتُحمّل الإجابات الأقدم من الخادم. يُنظّف السجل المحلي عند الفتح والاستئناف.',
    clearBody: 'ستُحذف النسخ المحلية فقط. لن تُحذف سجلات الخادم وقد تظهر مجددًا عند إعادة تحميل السجل.',
    accountNote: 'مسجّل الدخول إلى حساب Aether في هذا التطبيق.', audioLimits: 'نطق الجهاز. تتوفر الإعادة وإيقاف النطق؛ لا يتوفر الإيقاف المؤقت أو عرض المدة.',
    aloudNote: 'تُنطق الإجابات تلقائيًا بصوت الجهاز. لم تُنفّذ أدوات لاختيار الصوت أو السرعة.',
    steps: [ ['ابدأ معًا', 'اضغط ابدأ، أو فعّل «Hey Aether» في الإعدادات وقلها أثناء فتح التطبيق.'], ['اسأل بصوتك', 'بعد الترحيب، انتظر حالة أستمع إليك ثم اطرح سؤالك.'], ['استمع أو اقرأ', 'استمع إلى الرد. اضغط الإجابة لقراءتها أو إعادة سماعها.'], ['توقف متى شئت', 'اضغط إنهاء الجلسة. مغادرة التطبيق توقف الكاميرا والميكروفون أيضًا.'] ],
    fontFallback: 'فشل تحميل الخطوط؛ تُستخدم خطوط النظام.', permissionSettings: 'فتح إعدادات الجهاز', shareCancelled: 'أُلغيت المشاركة',
    stopped: 'أُوقفت الجلسة', unavailable: 'غير متاح', error: 'يحتاج إلى انتباه', pending: 'قيد الانتظار', off: 'متوقف',
    emptyConnection: 'اضبط عناوين الحاسوب قبل تسجيل الدخول.',
  },
};
export function copies(language: Language) {
  const n = { ...(language === 'fr' ? frNative : nativeCopy[language]), ...(language === 'fr' ? frTeam : teamCopy[language]),
    server_language_unavailable: language === 'fr' ? 'Ce serveur ne prend pas encore en charge les questions en français. Choisissez explicitement une autre langue ou attendez sa mise à jour.' : language === 'ar' ? 'لا يدعم هذا الخادم لغة السؤال بعد. اختر لغة أخرى أو انتظر تحديثه.' : 'This server does not support the question language yet. Choose another language or wait for its update.' };
  return { m: { ...(language === 'fr' ? frMono : monoCopy[language]), retention: n.retention, clearBody: n.clearBody, accountNote: n.accountNote, audioLimits: n.audioLimits, aloudNote: n.aloudNote, steps: n.steps },
    u: { ...(language === 'fr' ? frUI : uiCopy[language]), local: `${n.privacy} ${n.retention}`, clearBody: n.clearBody, photoNote: n.photoNote, playback: n.audioLimits },
    a: { ...(language === 'fr' ? frAuth : authCopy[language]), privacy: n.privacy }, n };
}
