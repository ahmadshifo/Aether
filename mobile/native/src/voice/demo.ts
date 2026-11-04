// PWA voiceSession.ts at bb54dbd: validation, duplicate window and demo wording.
import type { Language } from '../shared/types.ts';
export const validTranscript = (text: string, confidence?: number) => (text.match(/\p{L}+/gu) ?? []).length >= 2 && text.length <= 4000 && !(confidence !== undefined && confidence > 0 && confidence < 0.35);
const visionQuestion = (text: string) => /\b(see|look|looking|read|written|color|colour|object|front of me|picture|image|camera|sign|door|where is|what is in front)\b|(?:أمام|تشوف|ترى|مكتوب|اقرأ|لون|صورة|كاميرا|باب|أرى|انظر|أشوف|شايف)/iu.test(text);
export function demoAnswer(question: string, language: Language, cameraActive: boolean) {
  // Native camera activity and snapshot capability are separate facts.
  if (!cameraActive && visionQuestion(question)) return language === 'ar'
    ? 'الكاميرا متوقفة. شغّلها حتى أتمكن من وصف ما أمامك.'
    : 'The camera is off. Turn it on so I can describe what is in front of you.';
  return language === 'ar' ? 'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.' : 'The sign on the door reads Room 205.';
}
