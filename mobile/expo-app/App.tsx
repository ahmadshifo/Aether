import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraPreview } from './src/components/CameraPreview';
import { EchoIcon } from './src/components/EchoIcon';
import { colors, styles as s } from './src/components/theme';
import { HistorySheet } from './src/screens/HistorySheet';
import { words } from './src/i18n/words';
import { HISTORY_KEY, LANGUAGE_KEY, parseHistory, prependHistory } from './src/storage/history';
import { useAssistant } from './src/session/useAssistant';
import type { HistoryItem, Language } from './src/types';
export default function App() { return <SafeAreaProvider><Home/></SafeAreaProvider>; }
function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [goReady, setGoReady] = useState(false);
  const writes = useRef(Promise.resolve());
  const historyRef = useRef(history); historyRef.current = history;
  const t = words[language];
  const assistant = useAssistant(language, item => {
    const next = prependHistory(historyRef.current, item); historyRef.current = next; setHistory(next); setExpanded(false);
    writes.current = writes.current.then(() => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)))
      .catch(() => setStorageError(true));
  });
  const textDirection = { textAlign: language === 'ar' ? 'right' as const : 'left' as const,
    writingDirection: language === 'ar' ? 'rtl' as const : 'ltr' as const };
  const rowDirection = { flexDirection: language === 'ar' ? 'row-reverse' as const : 'row' as const };
  useEffect(() => {
    let alive = true;
    void AsyncStorage.multiGet([LANGUAGE_KEY, HISTORY_KEY]).then(values => {
      if (!alive) return;
      setLanguage(values[0]?.[1] === 'ar' ? 'ar' : 'en'); setHistory(parseHistory(values[1]?.[1] ?? null));
    }).catch(() => { if (alive) setStorageError(true); }).finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    // Announce meaningful phase changes, never every interim transcript.
    AccessibilityInfo.announceForAccessibility(t[assistant.phase]);
  }, [assistant.phase, language]);
  function changeLanguage(next: Language) {
    if (!hydrated || next === language) return;
    // Explicit Start after switching keeps all OS speech events in their original language.
    assistant.stop(); setLanguage(next);
    writes.current = writes.current.then(() => AsyncStorage.setItem(LANGUAGE_KEY, next)).catch(() => setStorageError(true));
  }
  const showingTranscript = assistant.active && assistant.phase === 'hearing' && !!assistant.transcript;
  const answerText = showingTranscript ? assistant.transcript : assistant.answer?.answer;
  const cameraLive = assistant.camera && (assistant.stream !== null || goReady);
  return <SafeAreaView style={s.safe}>
    <StatusBar barStyle="light-content"/>
    <View style={s.shell} importantForAccessibility={historyOpen ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={historyOpen}>
      <View style={[s.header, rowDirection]}>
        <View style={[s.brand, rowDirection]}><View style={s.mark}><EchoIcon name="eye" size={25}/></View>
          <View style={{ flexShrink: 1 }}><Text style={s.brandTitle}>EchoSight</Text><Text style={[s.subtitle, textDirection]}>{t.subtitle}</Text></View></View>
        <View style={s.switch} accessibilityLabel={t.language}>
          {(['en', 'ar'] as const).map(lang => <Pressable key={lang} accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'English' : 'العربية'}
            accessibilityState={{ selected: language === lang, disabled: !hydrated }} disabled={!hydrated}
            style={[s.language, language === lang && s.selected]} onPress={() => changeLanguage(lang)}>
            <Text style={[s.languageText, language === lang && { color: '#06221f' }]}>{lang.toUpperCase()}</Text>
          </Pressable>)}
        </View>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.stage}>
          {assistant.camera && <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <CameraPreview stream={assistant.stream} onReady={() => setGoReady(true)} onError={assistant.cameraError}/>
          </View>}
          <View style={s.welcome} pointerEvents="none" accessibilityElementsHidden={cameraLive} importantForAccessibility={cameraLive ? 'no-hide-descendants' : 'auto'}>
            {!cameraLive && <><View style={s.welcomeEye}><EchoIcon name="eye" size={46}/></View>
              <Text accessibilityRole="header" style={s.title}>{assistant.active ? t[assistant.phase] : t.idle}</Text>
              <Text style={[s.muted, { textAlign: 'center', fontSize: 14 }]}>{assistant.starting ? t.starting : assistant.active ? t.cameraFailed : t.welcomeHint}</Text></>}
          </View>
          <View style={[s.topOverlay, rowDirection]}>
            <View style={s.chip}><Text style={s.chipText}>{t.camera}: {cameraLive ? t.on : t.off}</Text></View>
            {assistant.active && <View style={s.chip}><Text style={[s.chipText, textDirection]}>{t[assistant.phase]}</Text></View>}
          </View>
          {assistant.active && !!answerText && <View style={s.answer}>
            <View style={[s.answerHeader, rowDirection]}><EchoIcon name="sparkles" size={17}/>
              <Text style={[s.label, { flex: 1 }, textDirection]}>{showingTranscript ? t.transcript : t.latest}</Text>
              {!showingTranscript && assistant.answer?.demo && <Text style={s.demo}>{t.demo}</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t.collapse : t.expand} accessibilityState={{ expanded }}
                onPress={() => setExpanded(value => !value)} style={s.iconButton}><EchoIcon name="chevron" size={17}/></Pressable>
              {!showingTranscript && assistant.answer && <Pressable accessibilityRole="button" accessibilityLabel={t.replay}
                disabled={assistant.phase === 'processing' || assistant.phase === 'speaking' || assistant.starting}
                accessibilityState={{ disabled: assistant.phase === 'processing' || assistant.phase === 'speaking' || assistant.starting }}
                onPress={() => void assistant.replay(assistant.answer!)} style={s.iconButton}><EchoIcon name="volume" size={21}/></Pressable>}
            </View>
            <Text selectable numberOfLines={expanded ? undefined : 2} style={[s.text, textDirection]}>{answerText}</Text>
          </View>}
        </View>
        <View style={s.panel}>
          <Text style={[s.muted, textDirection]}>{assistant.streamNotice}</Text>
          {!!assistant.voiceNotice && <Text style={[s.muted, textDirection]}>{assistant.voiceNotice}</Text>}
          {assistant.demo && <Text style={[s.muted, textDirection]}>{t.demoHint}</Text>}
          {!!assistant.sessionId && <Text selectable style={[s.muted, textDirection]}>{t.session}: {assistant.sessionId}</Text>}
        </View>
        {(!!assistant.error || storageError) && <View accessibilityLiveRegion="polite" style={[s.panel, s.error]}>
          {!!assistant.error && <Text style={[s.errorText, textDirection]}>{assistant.error}</Text>}
          {storageError && <Text style={[s.errorText, textDirection]}>{t.storageError}</Text>}
        </View>}
      </ScrollView>
      <View style={[s.dock, rowDirection]}>
        <View style={s.dockSlot}><Pressable accessibilityRole="button" accessibilityLabel={t.history} onPress={() => { assistant.stop(); setHistoryOpen(true); }} style={s.iconButton}>
          <EchoIcon name="history"/></Pressable><Text style={s.muted}>{t.history}</Text></View>
        <View style={s.dockSlot}><Pressable accessibilityRole="button" accessibilityLabel={assistant.active ? t.stopLabel : t.startLabel}
          accessibilityState={{ disabled: !hydrated, busy: assistant.starting }} disabled={!hydrated}
          onPress={() => { if (assistant.active) assistant.stop(); else { setGoReady(false); void assistant.start(); } }}
          style={[s.session, assistant.active && s.stop]}>
          {!hydrated ? <ActivityIndicator color={colors.bg}/> : <EchoIcon name={assistant.active ? 'stop' : 'eye'} size={34} color={assistant.active ? '#fff' : '#06222b'}/>}
        </Pressable><Text style={s.text}>{assistant.active ? t.stop : t.start}</Text></View>
        <View style={s.dockSlot}/>
      </View>
    </View>
    {historyOpen && <HistorySheet language={language} items={history} onClose={() => { assistant.stop(); setHistoryOpen(false); }} onReplay={item => void assistant.replay(item)}/>}
  </SafeAreaView>;
}
