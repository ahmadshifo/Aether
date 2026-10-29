import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Camera } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { words } from '../i18n/words';
import { loadRecognition, rtcAvailable } from '../native/capabilities';
import { acquireNativeCamera, releaseCamera, rtcFactory } from '../streaming/nativeCamera';
import { WhipPublisher, type StreamStatus } from '../streaming/WhipPublisher';
import { DeviceRecognition } from '../voice/DeviceRecognition';
import { DeviceSpeaker } from '../voice/DeviceSpeaker';
import type { HistoryItem, Language, Phase } from '../types';
import { Lifetime } from './Lifetime';
import { ask } from './ask';
type Run = { life: Lifetime; id: string; voice?: DeviceRecognition; speaking: boolean; processing: boolean };
const mediaBase = process.env.EXPO_PUBLIC_MEDIAMTX_URL?.trim().replace(/\/$/, '') ?? '';
const aiBase = process.env.EXPO_PUBLIC_AI_API_BASE_URL?.trim() ?? '';
export function useAssistant(language: Language, onAnswer: (item: HistoryItem) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [camera, setCamera] = useState(false);
  const [stream, setStream] = useState<Awaited<ReturnType<typeof acquireNativeCamera>> | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('off');
  const [voiceNotice, setVoiceNotice] = useState('');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState<HistoryItem | null>(null);
  const [sessionId, setSessionId] = useState('');
  const current = useRef<Run | null>(null);
  const speaker = useRef(new DeviceSpeaker()).current;
  const onAnswerRef = useRef(onAnswer); onAnswerRef.current = onAnswer;
  const mounted = useRef(true);

  function stop(update = true) {
    const run = current.current; current.current = null;
    run?.life.stop(); speaker.stop();
    if (update && mounted.current) {
      setActive(false); setStarting(false); setPhase('idle'); setCamera(false); setStream(null);
      setStreamStatus('off'); setTranscript(''); setVoiceNotice('');
    }
  }
  async function start() {
    if (current.current || AppState.currentState === 'background') return;
    speaker.stop();
    const run: Run = { life: new Lifetime(), id: Crypto.randomUUID(), speaking: false, processing: false };
    current.current = run;
    const live = () => run.life.active && mounted.current;
    const t = words[language];
    const report = (value: string) => { if (live()) setError(value); };
    const changePhase = (value: Phase) => { if (live()) setPhase(value); };
    setActive(true); setStarting(true); setPhase('starting'); setError(''); setTranscript(''); setVoiceNotice('');
    setAnswer(null); setSessionId(run.id);
    run.life.own(() => speaker.stop());
    try {
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!live()) return;
      if (!permission.granted) report(t.cameraFailed);
      else if (rtcAvailable) {
        try {
          const nativeStream = await acquireNativeCamera();
          run.life.own(() => releaseCamera(nativeStream));
          if (!live()) return;
          setStream(nativeStream); setCamera(true);
          if (mediaBase) {
            const publisher = new WhipPublisher(rtcFactory(), fetch,
              status => { if (live()) setStreamStatus(status); }, e => report(e.message));
            run.life.own(() => publisher.stop());
            void publisher.start(nativeStream, `${mediaBase}/live/${run.id}/whip`).catch(e => report(String(e)));
          }
        } catch { report(t.cameraFailed); }
      } else setCamera(true); // CameraView owns only the Expo Go camera.
      if (!live()) return;
      changePhase('ready');
      const voice = new DeviceRecognition(language, changePhase,
        value => { if (live()) setTranscript(value); },
        value => { if (live()) setVoiceNotice(value); },
        async question => {
          if (!live()) return;
          run.processing = true;
          changePhase('processing');
          const id = Crypto.randomUUID();
          const request = new AbortController();
          const abortRequest = () => request.abort();
          run.life.controller.signal.addEventListener('abort', abortRequest, { once: true });
          const timeout = setTimeout(abortRequest, 20000);
          try {
            const text = aiBase ? await ask(aiBase, run.id, id, question, language, request.signal) : t.demoAnswer;
            if (!live()) return;
            const item: HistoryItem = { id, sessionId: run.id, question, answer: text, language,
              time: new Date().toISOString(), demo: !aiBase };
            setAnswer(item); onAnswerRef.current(item);
            await speaker.speak(text, language, () => changePhase('speaking'), report);
          } catch (reason) { if (live()) report(`AI: ${String(reason)}`); }
          finally {
            run.processing = false;
            clearTimeout(timeout); run.life.controller.signal.removeEventListener('abort', abortRequest);
            if (live()) changePhase('ready');
          }
        }, loadRecognition());
      run.voice = voice; run.life.own(() => voice.stop());
      await voice.start();
    } catch (reason) { report(String(reason)); }
    finally { if (live()) { setStarting(false); setPhase(previous => previous === 'starting' ? 'ready' : previous); } }
  }
  async function replay(item: HistoryItem) {
    const run = current.current;
    // Cancel a queued answer/request before replay, avoiding overlapping speech.
    if (run?.speaking || run?.processing) return;
    if (run) { run.speaking = true; run.voice?.pause(); }
    await speaker.speak(item.answer, item.language,
      () => { if (mounted.current) setPhase('speaking'); },
      value => { if (mounted.current) setError(value); });
    if (run) run.speaking = false;
    if (!mounted.current) return;
    if (current.current === run && run?.life.active) { setPhase('ready'); await run.voice?.listen(); }
    else if (!current.current) setPhase('idle');
  }
  function cameraError() { setCamera(false); setError(words[language].cameraFailed); }
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => { if (state === 'background') stop(); });
    return () => { mounted.current = false; sub.remove(); stop(false); };
  }, []);
  return { phase, active, starting, camera, stream, streamStatus, voiceNotice, error, transcript,
    answer, sessionId, start, stop: () => stop(), replay, cameraError,
    streamNotice: !rtcAvailable ? words[language].streamGo : !mediaBase ? words[language].streamMissing
      : words[language][streamStatus === 'connected' ? 'streaming' : streamStatus === 'connecting' ? 'connecting' : 'streamOff'],
    demo: !aiBase,
  };
}
