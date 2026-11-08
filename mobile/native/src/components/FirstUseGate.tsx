import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Text, View, findNodeHandle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Frame } from './Frame';
import { Button, Card, Notice, T, useUI } from './ui';
import { safetyCopy } from '../i18n/safetyCopy';
import { copies } from '../i18n/nativeCopy';
import { SpeechOwner } from '../voice/speech';
import type { Language } from '../shared/types';

export const SAFETY_KEY = 'aether-safety-acknowledged-v1';
// Installation-level acknowledgement: shown before sign-in, independent of server/account changes.
export function FirstUseGate({ children, changeLanguage, review = false, onDone }: { children: React.ReactNode; changeLanguage(language: Language): void; review?: boolean; onDone?(): void }) {
  const { language, colors } = useUI(), text = safetyCopy[language];
  const [status, setStatus] = useState<'loading' | 'notice' | 'accepted'>('loading');
  const [speaking, setSpeaking] = useState(false), [error, setError] = useState<'audioError' | 'saveError'>(), [saving, setSaving] = useState(false);
  const [speech] = useState(() => new SpeechOwner());
  const generation = useRef(0), mounted = useRef(true), savingRef = useRef(false);
  const heading = useRef<React.ComponentRef<typeof Text>>(null);
  useEffect(() => {
    mounted.current = true;
    if (review) setStatus('notice');
    else void AsyncStorage.getItem(SAFETY_KEY).then(value => { if (mounted.current) setStatus(value === 'acknowledged' ? 'accepted' : 'notice'); })
      .catch(() => { if (mounted.current) setStatus('notice'); });
    return () => { mounted.current = false; generation.current++; speech.stop(); };
  }, [speech, review]);
  const stop = () => { generation.current++; speech.stop(); setSpeaking(false); };
  const read = async () => {
    const token = ++generation.current; setError(undefined); setSpeaking(true);
    const result = await speech.speak(text.body, language, () => {}).catch(() => 'error');
    if (!mounted.current || token !== generation.current) return;
    setSpeaking(false); if (result === 'error') setError('audioError');
  };
  useEffect(() => {
    if (status !== 'notice') return;
    let current = true;
    const id = findNodeHandle(heading.current); if (id) AccessibilityInfo.setAccessibilityFocus(id);
    // VoiceOver/TalkBack already reads the focused notice. Avoid competing automatic voices.
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => { if (current && !enabled && AppState.currentState === 'active') void read(); }).catch(() => {});
    const app = AppState.addEventListener('change', value => { if (value !== 'active') stop(); });
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => { current = false; generation.current++; speech.stop(); app.remove(); back.remove(); };
  }, [status, language, speech]);
  const accept = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); stop(); setError(undefined);
    try { if (!review) await AsyncStorage.setItem(SAFETY_KEY, 'acknowledged'); if (mounted.current) { setStatus('accepted'); onDone?.(); } }
    catch { if (mounted.current) setError('saveError'); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  if (status === 'accepted') return <>{children}</>;
  const content = <>
    {status === 'loading' ? <T>{copies(language).u.loading}</T> : <>
      <Card><Text ref={heading} accessible accessibilityRole="header" accessibilityLabel={`${text.title}. ${text.body}`} style={{ fontSize: 28, color: colors.ink, textAlign: language === 'ar' ? 'right' : 'left', writingDirection: language === 'ar' ? 'rtl' : 'ltr' }}>{text.title}</Text>
        <T>{text.body}</T>
      </Card>
      <Button label={speaking ? text.stop : text.listen} onPress={() => { if (speaking) stop(); else void read(); }} />
      {error && <Notice danger>{text[error]}</Notice>}
      <Button primary disabled={saving} label={text.accept} onPress={() => { void accept(); }} />
    </>}
  </>;
  return review ? <View style={{ gap: 24 }}>{content}</View> : <Frame languageChange={changeLanguage}>{content}</Frame>;
}
