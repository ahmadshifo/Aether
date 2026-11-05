import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Pressable, ScrollView, Switch, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as KeepAwake from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system/legacy';
import { Frame } from '../components/Frame';
import { GlassBottomBar } from '../components/GlassBottomBar';
import { Button, Card, HoldButton, Mark, Notice, Row, Sheet, T, UIContext, useUI } from '../components/ui';
import Icon from '../components/Icon';
import { copies } from '../i18n/nativeCopy';
import type { AuthController, AuthSession } from '../auth/authController';
import type { Endpoints } from '../platform/config';
import type { Language, Page } from '../shared/types';
import { themeModes, type ThemeMode } from '../theme/tokens';
import { capabilities } from '../platform/capabilities';
import { nativeFetch } from '../platform/network';
import { permissionPending } from '../platform/permissions';
import { GoCamera, nativeCamera, nativePublisher } from '../platform/camera';
import { sessionHaptics } from '../platform/sessionHaptics';
import { AssistantScreen } from './AssistantScreen';
import { SessionController } from '../session/controller';
import { prepareRecognition, recognize } from '../voice/recognition';
import { listenForWakeWord } from '../voice/wakeWord';
import { SpeechOwner } from '../voice/speech';
import { StreamRegistry } from '../streaming/registry';
import { HistoryRepository } from '../storage/history';
import { discardPhoto, nativeStorage, savePhoto } from '../storage/nativeStorage';
import { ConnectionScreen } from './ConnectionScreen';
import { HelpScreen } from './HelpScreen';
import { HistoryScreen, entryTime } from './HistoryScreen';
type Preferences = { welcome?: boolean; motion?: boolean; haptics?: boolean; wake?: boolean };
export function Account({ auth, session, endpoints, saveEndpoints, changeLanguage, themeMode, changeTheme }: { auth: AuthController; session: AuthSession; endpoints: Endpoints; saveEndpoints(value: Endpoints): void; changeLanguage(language: Language): void; themeMode: ThemeMode; changeTheme(mode: ThemeMode): void }) {
  const ui = useUI(), { language, colors } = ui, { m, u, n } = copies(language), dimensions = useWindowDimensions();
  const [page, setPage] = useState<Page>('welcome'), [preferences, setPreferences] = useState<Preferences>({}), [loaded, setLoaded] = useState(false), [selected, setSelected] = useState(0), [prompt, setPrompt] = useState<number | null>(null), [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'leave' | 'clear' | 'logout' | null>(null);
  const heading = useRef<React.ComponentRef<typeof Text>>(null), alive = useRef(true), currentPrefs = useRef(preferences), preferenceQueue = useRef(Promise.resolve());
  const wakeListener = useRef<(() => Promise<void>) | undefined>(undefined);
  const assistantBack = useRef<React.ComponentRef<typeof View>>(null);
  const focus = useCallback(() => { const id = findNodeHandle(heading.current ?? assistantBack.current); if (id) AccessibilityInfo.setAccessibilityFocus(id); }, []);
  const [runtime] = useState(() => {
    const allowed = () => alive.current && auth.authorized(session.owner);
    const repository = new HistoryRepository(session.owner, nativeStorage, allowed), camera = new GoCamera(), speech = new SpeechOwner(), registry = new StreamRegistry(endpoints.backend, nativeFetch), caps = capabilities();
    let wakeGeneration = 0, wakeTag: string | undefined;
    const controller = new SessionController({
      preview: caps.go && __DEV__, recognitionAvailable: caps.recognition, streamingAvailable: caps.webrtc,
      allowed, uuid: () => Crypto.randomUUID(), camera: caps.webrtc ? nativeCamera : caps.go ? camera.acquire : async () => { throw Error('native_required'); },
      prepareStart: async () => { await wakeListener.current?.(); },
      sessionOpened: () => sessionHaptics(currentPrefs.current.haptics === true),
      prepareRecognition, recognition: recognize, speak: speech.speak, stopSpeech: speech.stop,
      publish: (handle, id, state) => nativePublisher(handle, `${endpoints.media}/live/${id}/whip`, state), register: (action, id) => registry.request(action, id),
      keepAwake: active => {
        const g = ++wakeGeneration;
        if (wakeTag) void KeepAwake.deactivateKeepAwake(wakeTag);
        wakeTag = active ? `aether-session-${session.owner.epoch}-${g}` : undefined;
        if (wakeTag) { const tag = wakeTag; void KeepAwake.activateKeepAwakeAsync(tag).then(() => { if (g !== wakeGeneration) void KeepAwake.deactivateKeepAwake(tag); }).catch(() => {}); }
      },
      savePhoto: async (snapshot, valid) => { try { return await savePhoto(repository.key, snapshot.uri, snapshot.capturedAt, valid); } finally { await FileSystem.deleteAsync(snapshot.uri, { idempotent: true }).catch(() => {}); } },
      discardPhoto: photo => { void discardPhoto(repository.key, photo).catch(() => {}); }, answer: entry => repository.upsert(entry),
      discardSnapshot: snapshot => { void FileSystem.deleteAsync(snapshot.uri, { idempotent: true }).catch(() => {}); },
    });
    return { repository, camera, controller, caps };
  });
  const media = useSyncExternalStore(runtime.controller.subscribe, runtime.controller.getSnapshot), history = useSyncExternalStore(runtime.repository.subscribe, runtime.repository.getSnapshot);
  const prefsKey = `${runtime.repository.key}:display`;
  useEffect(() => {
    void AsyncStorage.getItem(prefsKey).then(raw => {
      if (!alive.current || !auth.authorized(session.owner)) return;
      const value = raw ? JSON.parse(raw) : {}; const safe = { welcome: value.welcome === true, motion: value.motion !== false, haptics: value.haptics === true, wake: value.wake === true };
      currentPrefs.current = safe; setPreferences(safe); setPage(safe.welcome ? 'home' : 'welcome'); setLoaded(true);
    }).catch(() => { if (alive.current) setLoaded(true); });
    const lock = auth.onLock(() => { runtime.controller.stop(); setConfirm(null); setNotice(''); });
    return () => { alive.current = false; lock(); runtime.controller.dispose(); runtime.repository.dispose(); };
  }, [auth, prefsKey, runtime, session.owner]);
  useEffect(() => { focus(); }, [page, focus]);
  useEffect(() => {
    const timer = setInterval(() => runtime.repository.expire(), 30000);
    const sub = AppState.addEventListener('change', value => { if ((value === 'background' || value === 'inactive') && !permissionPending()) runtime.controller.stop(true); else if (value === 'active') runtime.repository.expire(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [runtime]);
  const navigate = (next: Page) => { setNotice(''); if (next === 'history') runtime.controller.pause(); setPage(next); };
  const back = () => { if (page === 'assistant' && media.active) setConfirm('leave'); else navigate('home'); };
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (confirm) { setConfirm(null); return true; } if (page !== 'home') { if (page === 'assistant' && media.active) setConfirm('leave'); else setPage('home'); return true; } return false; }); return () => sub.remove(); }, [page, media.active, confirm]);
  const updatePrefs = (patch: Preferences) => {
    const next = { ...currentPrefs.current, ...patch }; currentPrefs.current = next; setPreferences(next);
    preferenceQueue.current = preferenceQueue.current.then(() => AsyncStorage.setItem(prefsKey, JSON.stringify(next))).catch(() => { if (alive.current) setNotice(u.storageError); });
  };
  const start = (question: number | null = null) => { if (!auth.authorized(session.owner)) return; setPrompt(question); setPage('assistant'); if (!media.active) void runtime.controller.start(language); };
  // "Hey Aether": only with the switch on, with the app on screen, and never while a session or the app's own voice is running.
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => setForeground(value === 'active' || permissionPending()));
    return () => sub.remove();
  }, []);
  const wakeOn = loaded && preferences.wake === true && runtime.caps.recognition && foreground && !media.active && media.phase !== 'speaking' && page !== 'assistant' && !confirm;
  useEffect(() => {
    if (!wakeOn) return;
    const stop = listenForWakeWord(() => start(), () => { updatePrefs({ wake: false }); setNotice(m.wakeUnavailable); });
    wakeListener.current = stop;
    return () => { void stop(); };
  }, [wakeOn, language]);
  const finishWelcome = () => { updatePrefs({ welcome: true }); navigate('home'); };
  const confirmAction = () => { const action = confirm; setConfirm(null); if (action === 'logout') void auth.logout(); else if (action === 'clear') { runtime.repository.clear(); setNotice(u.cleared); } else { runtime.controller.stop(); setPrompt(null); if (action === 'leave') navigate('home'); } };
  const fan = dimensions.width >= 390 && dimensions.fontScale < 1.3;
  const footer = page !== 'welcome' && <GlassBottomBar page={page} onNavigate={navigate} onStart={() => start()} />;
  return <UIContext.Provider value={{ ...ui, motion: ui.motion && preferences.motion !== false, haptics: preferences.haptics === true }}>
    {loaded && page === 'assistant' ? <AssistantScreen media={media} controller={runtime.controller} camera={runtime.camera} caps={runtime.caps} prompt={prompt} start={() => start(prompt)} back={back} backRef={assistantBack} changeLanguage={lang => { runtime.controller.changeLanguage(lang); changeLanguage(lang); }} /> : <Frame back={page === 'connection' ? back : undefined} languageChange={lang => { runtime.controller.changeLanguage(lang); changeLanguage(lang); }} footer={loaded ? footer : undefined}>
      <Text ref={heading} accessibilityRole="header" style={{ color: colors.muted, fontSize: 12 }}>{page === 'welcome' ? 'AETHER / 01' : `AETHER / ${m[page]}`}</Text>
      {!loaded ? <T>{u.loading}</T> : <>
        {page === 'welcome' && <View style={{ gap: 24 }}><View style={{ alignItems: 'center', gap: 20 }}><Mark size={130} /><T variant="title">{m.welcome}</T><T>{m.welcomeBody}</T></View><Notice>{n.demoExplanation}</Notice>
          {[[m.camera, m.cameraWhy], [m.microphone, m.microphoneWhy]].map(([label, body]) => <Card key={label}><T variant="heading">{label}</T><T>{body}</T></Card>)}
          <T variant="small">{m.permission}</T><Button primary label={m.getStarted} onPress={finishWelcome} /><Notice>{m.safety}</Notice>
        </View>}
        {page === 'home' && <View style={{ gap: 28 }}><Row><View style={{ flex: 1 }}><T variant="title">{m.hello}</T><T>{session.user.name}</T><T>{m.greeting}</T></View><Button label={m.connection} onPress={() => navigate('connection')} /></Row>
          <Card style={{ padding: 24 }}><Row style={{ flexWrap: 'nowrap' }}><Mark size={dimensions.width < 380 ? 72 : 92} /><View style={{ flex: 1 }}><T variant="label">AETHER / 01</T><T variant="heading">{m.feature}</T></View></Row><Button primary label={media.active ? m.returnSession : m.start} icon="mic" onPress={() => start()} /></Card>
          <T variant="heading">{m.quick}</T>
          <ScrollView horizontal contentContainerStyle={{ flexDirection: language === 'ar' ? 'row-reverse' : 'row', paddingVertical: 20, paddingHorizontal: 8, gap: fan ? 0 : 12, minHeight: fan ? 220 : undefined }} showsHorizontalScrollIndicator={!fan}>
            {m.questions.map((question, index) => <Pressable key={question} accessibilityRole="button" accessibilityLabel={question} accessibilityState={{ selected: selected === index }} onPress={() => setSelected(index)} style={{ width: 118, minHeight: 160, padding: 12, borderWidth: selected === index ? 2 : 1, borderColor: selected === index ? colors.ink : colors.muted, borderRadius: 10, backgroundColor: colors.card, gap: 12, marginLeft: fan && index > 0 ? -52 : 0, zIndex: selected === index ? 10 : 5 - Math.abs(selected - index), transform: fan ? [{ rotate: `${(index - 2) * (language === 'ar' ? -5 : 5)}deg` }, { translateY: Math.abs(index - 2) * 6 + (selected === index ? -10 : 0) }] : [] }}><T variant="label">{String(index + 1).padStart(2, '0')}                     Q</T><Icon name={(['eye', 'search', 'history', 'arrow-right', 'sparkles'] as const)[index]} color={colors.ink} /><T style={{ fontSize: 13 }}>{question}</T></Pressable>)}
          </ScrollView>
          <Card style={{ backgroundColor: colors.inset }}><T variant="label">{m.selected}</T><T>{m.questions[selected]}</T><Button primary label={m.ask} onPress={() => start(selected)} /><T variant="small">{m.say}</T></Card>
          <Row><T variant="heading" style={{ flex: 1 }}>{m.recent}</T><Button label={m.viewHistory} onPress={() => navigate('history')} /></Row>
          {history.loading ? <T>{u.loading}</T> : history.items[0] ? <Card><T variant="small">{entryTime(history.items[0], language)}</T><T language={history.items[0].language}>{history.items[0].question}</T><Button label={m.viewHistory} onPress={() => navigate('history')} /></Card> : <T>{u.emptyTitle}</T>}
          {history.error && <Notice danger>{u.storageError}</Notice>}
        </View>}
        {page === 'history' && <HistoryScreen repository={runtime.repository} state={history} replay={entry => { void runtime.controller.replay(entry); }} active={media.active} speaking={media.phase === 'speaking'} stopSpeech={() => runtime.controller.stopPlayback()} focus={focus} />}
        {page === 'settings' && <View style={{ gap: 24 }}><T variant="title">{m.settings}</T>
          <T variant="heading">{m.appearance}</T><Card><View style={{ gap: 8 }}>{themeModes.map(mode => <Button key={mode} label={mode === 'system' ? m.themeSystem : mode === 'light' ? m.themeLight : m.themeDark} icon={themeMode === mode ? 'check' : mode === 'system' ? 'phone' : mode === 'light' ? 'sun' : 'moon'} selected={themeMode === mode} onPress={() => changeTheme(mode)} />)}</View></Card>
          <T variant="heading">{m.voice}</T><Card>
          {([['wake', m.wake, m.wakeNote], ['haptics', m.vibrate, m.vibrateNote], ['motion', m.motion, m.motionNote]] as const).map(([key, label, body]) => <View key={key} style={{ gap: 8 }}><Row><T style={{ flex: 1 }}>{label}</T><Switch accessibilityLabel={label} trackColor={{ false: colors.muted, true: colors.ok }} thumbColor={colors.card} value={key === 'motion' ? preferences.motion !== false : preferences[key] === true} onValueChange={value => updatePrefs({ [key]: value })} /></Row><T variant="small">{body}</T></View>)}</Card>
          <T variant="heading">{m.local}</T><Card><HoldButton clear disabled={history.loading || !history.items.length} onConfirm={() => { runtime.repository.clear(); setNotice(u.cleared); }} onOptions={() => setConfirm('clear')} /></Card>
          <Button label={m.connection} onPress={() => navigate('connection')} /><Button label={m.how} onPress={() => navigate('help')} /><Card><T variant="heading">{m.account}</T><T>{session.user.name}</T><T selectable style={{ writingDirection: 'ltr' }}>{session.user.email}</T><Button danger label={m.signOut} onPress={() => setConfirm('logout')} /></Card>
        </View>}
        {page === 'help' && <HelpScreen />}{page === 'connection' && <ConnectionScreen endpoints={endpoints} onSave={saveEndpoints} signedIn session={media} />}
        {!!notice && <Notice>{notice}</Notice>}
      </>}
    </Frame>}
    {confirm && <Sheet restoreFocus={focus} title={confirm === 'logout' ? u.signOutTitle : confirm === 'clear' ? m.clearTitle : confirm === 'leave' ? m.leaveTitle : m.stopTitle} onClose={() => setConfirm(null)}><T>{confirm === 'logout' ? u.signOutBody : confirm === 'clear' ? n.clearBody : m.stopBody}</T><Button label={m.cancel} onPress={() => setConfirm(null)} /><Button danger label={confirm === 'logout' ? m.signOut : confirm === 'clear' ? m.clear : m.stop} onPress={confirmAction} /></Sheet>}
  </UIContext.Provider>;
}
