import { loadRecognition } from '../platform/capabilities';
import type { Language } from '../shared/types';
import type { RecognitionEvents } from '../session/controller';
import { duringPermission } from '../platform/permissions';
export async function recognize(language: Language, events: RecognitionEvents, signal: AbortSignal, options:{continuous?:boolean;onDevice?:boolean;phrases?:string[]}={}): Promise<() => Promise<void>> {

  const module = loadRecognition();
  const permission = await duringPermission(() => module.requestPermissionsAsync(), signal);

  if (signal.aborted) return async () => {};
  if (!permission.granted || !module.isRecognitionAvailable()) throw Error('recognition_denied');

  const supported = await module.getSupportedLocales({}).catch(() => ({ locales: [] as string[], installedLocales: [] as string[] }));
  if (signal.aborted) return async () => {};

  const choices = language === 'ar' ? ['ar-LB', 'ar-SA', ...supported.locales.filter(x => x.startsWith('ar'))] : ['en-US', ...supported.locales.filter(x => x.startsWith('en'))];
  // Android's list can hold only offline languages, so a language missing from it may still work online.
  const locale = choices.find(x => supported.locales.includes(x)) ?? (options.onDevice && supported.locales.length ? undefined : choices[0]);
  if (!locale) { events.error('language-not-supported'); return async () => {}; }

  let ended = false, stopped = false, finishStop: (() => void) | undefined;
  let startTimer: ReturnType<typeof setTimeout>;
  const subscriptions = [
    module.addListener('start', () => { clearTimeout(startTimer); if (!stopped && !signal.aborted) events.start(); }),
    module.addListener('result', event => { if (!stopped && !signal.aborted) { const result = event.results[0]; if (result) events.result(result.transcript, event.isFinal, result.confidence); } }),
    module.addListener('error', event => { if (!stopped && !signal.aborted) events.error(event.error); }),
    module.addListener('end', () => { ended = true; clearTimeout(startTimer); finishStop?.(); if (!stopped && !signal.aborted) events.end(); }),
  ];

  let stopPromise: Promise<void> | undefined;
  const stop = () => stopPromise ??= (async () => {
    stopped = true; clearTimeout(startTimer); signal.removeEventListener('abort', abort);
    if (!ended) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1200);
      finishStop = () => { clearTimeout(timer); resolve(); };
      try { module.abort(); } catch { finishStop(); }
    });
    subscriptions.forEach(subscription => subscription.remove());
  })();

  const abort = () => { void stop(); };
  signal.addEventListener('abort', abort, { once: true });
  startTimer = setTimeout(() => { if (!stopped) { events.error('service-not-allowed'); void stop(); } }, 10000);
  try { module.start({ lang: locale, interimResults: true, continuous: options.continuous===true, maxAlternatives: 1, requiresOnDeviceRecognition: options.onDevice===true, ...(options.phrases ? { contextualStrings: options.phrases } : {}), recordingOptions: { persist: false } }); }

  catch { await stop(); throw Error('recognition_failed'); }
  if (signal.aborted) await stop();
  return stop;
}
