import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Pressable, ScrollView, Switch, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as KeepAwake from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system/legacy';
import { Frame } from '../components/Frame';
import { Button, Card, Cassette, Field, HoldButton, Mark, Notice, Reveal, Row, Sheet, T, UIContext, useUI } from '../components/ui';
import Icon from '../components/Icon';
import { copies } from '../i18n/nativeCopy';
import type { AuthController, AuthSession } from '../auth/authController';
import type { Endpoints } from '../platform/config';
import type { Language, Page } from '../shared/types';
import { capabilities } from '../platform/capabilities';
import { nativeFetch } from '../platform/network';
import { permissionPending } from '../platform/permissions';
import { GoCamera, GoCameraPreview, nativeCamera, nativePublisher, RtcPreview } from '../platform/camera';
import { SessionController } from '../session/controller';
import { recognize } from '../voice/recognition';
import { SpeechOwner } from '../voice/speech';
import { StreamRegistry } from '../streaming/registry';
import { HistoryRepository } from '../storage/history';
import { discardPhoto, nativeStorage, savePhoto } from '../storage/nativeStorage';
import { ConnectionScreen } from './ConnectionScreen';
import { HelpScreen } from './HelpScreen';
import { HistoryScreen, entryTime } from './HistoryScreen';
type Preferences = { welcome?: boolean; motion?: boolean; haptics?: boolean };
export function Account({ auth, session, endpoints, saveEndpoints, changeLanguage }: { auth: AuthController; session: AuthSession; endpoints: Endpoints; saveEndpoints(value: Endpoints): void; changeLanguage(language: Language): void }) {
  const ui = useUI(), { language, colors } = ui, { m, u, n } = copies(language), dimensions = useWindowDimensions();
  const [page, setPage] = useState<Page>('welcome'), [preferences, setPreferences] = useState<Preferences>({}), [loaded, setLoaded] = useState(false), [selected, setSelected] = useState(0), [prompt, setPrompt] = useState<number | null>(null), [typed, setTyped] = useState(''), [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'stop' | 'leave' | 'clear' | 'logout' | null>(null);
  const heading = useRef<React.ComponentRef<typeof Text>>(null), alive = useRef(true), currentPrefs = useRef(preferences), preferenceQueue = useRef(Promise.resolve());
  const focus = useCallback(() => { const id = findNodeHandle(heading.current); if (id) AccessibilityInfo.setAccessibilityFocus(id); }, []);
  const [runtime] = useState(() => {
    const allowed = () => alive.current && auth.authorized(session.owner);
    const repository = new HistoryRepository(session.owner, nativeStorage, allowed), camera = new GoCamera(), speech = new SpeechOwner(), registry = new StreamRegistry(endpoints.backend, nativeFetch), caps = capabilities();
    let wakeGeneration = 0, wakeTag: string | undefined;
    const controller = new SessionController({
      preview: caps.go && __DEV__, recognitionAvailable: caps.recognition, streamingAvailable: caps.webrtc,
      allowed, uuid: () => Crypto.randomUUID(), camera: caps.webrtc ? nativeCamera : caps.go ? camera.acquire : async () => { throw Error('native_required'); },
      recognition: recognize, speak: speech.speak, stopSpeech: speech.stop,
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
      const value = raw ? JSON.parse(raw) : {}; const safe = { welcome: value.welcome === true, motion: value.motion !== false, haptics: value.haptics === true };
      currentPrefs.current = safe; setPreferences(safe); setPage(safe.welcome ? 'home' : 'welcome'); setLoaded(true);
    }).catch(() => { if (alive.current) setLoaded(true); });
    const lock = auth.onLock(() => { runtime.controller.stop(); setConfirm(null); setTyped(''); setNotice(''); });
    return () => { alive.current = false; lock(); runtime.controller.dispose(); runtime.repository.dispose(); };
  }, [auth, prefsKey, runtime, session.owner]);
  useEffect(() => { focus(); }, [page, focus]);
  useEffect(() => {
    const timer = setInterval(() => runtime.repository.expire(), 30000);
    const sub = AppState.addEventListener('change', value => { if (value === 'background' || value === 'inactive' && !permissionPending()) runtime.controller.stop(true); else if (value === 'active') runtime.repository.expire(); });
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
  const finishWelcome = () => { updatePrefs({ welcome: true }); navigate('home'); };
  const confirmAction = () => { const action = confirm; setConfirm(null); if (action === 'logout') void auth.logout(); else if (action === 'clear') { runtime.repository.clear(); setNotice(u.cleared); } else { runtime.controller.stop(); setPrompt(null); if (action === 'leave') navigate('home'); } };
  const phase = media.phase === 'unavailable' ? n.unavailable : media.phase === 'error' ? n.error : media.phase === 'starting' ? m.starting : media.phase === 'idle' ? m.ready : m[media.phase];
  const fan = dimensions.width >= 390 && dimensions.fontScale < 1.3;
  const footer = page === 'assistant' ? <View style={{ padding: 16, borderTopWidth: 1, borderColor: colors.divider }}>
    {media.active ? <HoldButton onConfirm={() => runtime.controller.stop()} onOptions={() => setConfirm('stop')} /> : <Button primary large label={m.start} icon="camera" onPress={() => start(prompt)} />}
  </View> : page !== 'welcome' && <Row style={{ margin: 12, marginTop: 26, padding: 6, flexWrap: 'nowrap', borderWidth: 1, borderColor: colors.lineCard, borderRadius: 16, backgroundColor: colors.card, gap: 2 }}>
    {(['home', 'history', 'assistant', 'help', 'settings'] as const).map(destination => <Pressable key={destination} accessibilityRole="tab" accessibilityLabel={destination === 'assistant' ? `${m.assistant}: ${m.startLabel}` : m[destination]} accessibilityState={{ selected: page === destination }} onPress={() => destination === 'assistant' ? start() : navigate(destination)} style={{ flex: 1, minHeight: 60, paddingVertical: 8, paddingHorizontal: 2, alignItems: 'center', gap: 6, backgroundColor: page === destination ? colors.inset : undefined, borderRadius: 10 }}>
      {destination === 'assistant' ? <View style={{ marginTop: -26, borderWidth: 4, borderColor: colors.card, borderRadius: 14, overflow: 'hidden' }}><Mark size={48} /></View> : <Icon name={destination === 'help' ? 'circle-help' : destination} color={colors.ink} />}
      <T style={{ fontSize: 11, textAlign: 'center' }}>{m[destination]}</T>
    </Pressable>)}
  </Row>;
  return <UIContext.Provider value={{ ...ui, motion: ui.motion && preferences.motion !== false, haptics: preferences.haptics === true }}>
    <Frame back={page === 'assistant' || page === 'connection' ? back : undefined} languageChange={lang => { runtime.controller.changeLanguage(lang); changeLanguage(lang); }} footer={loaded ? footer : undefined}>
      <Text ref={heading} accessibilityRole="header" style={{ color: colors.muted, fontSize: 12 }}>{page === 'welcome' ? 'AETHER / 01' : `AETHER / ${m[page]}`}</Text>
      {!loaded ? <T>{u.loading}</T> : <>
        {page === 'welcome' && <View style={{ gap: 24 }}><View style={{ alignItems: 'center', gap: 20 }}><Mark size={130} /><T variant="title">{m.welcome}</T><T>{m.welcomeBody}</T></View><Notice>{n.demoExplanation}</Notice>
          {[[m.camera, m.cameraWhy], [m.microphone, m.microphoneWhy]].map(([label, body]) => <Card key={label}><T variant="heading">{label}</T><T>{body}</T><T variant="small">{m.permission}</T><Button label={m.setup} onPress={finishWelcome} /></Card>)}
          <T variant="small">{m.permissionNote}</T><Button primary label={m.getStarted} onPress={finishWelcome} /><Notice>{m.safety}</Notice><T variant="small">{n.retention}</T>
        </View>}
        {page === 'home' && <View style={{ gap: 28 }}><Row><View style={{ flex: 1 }}><T variant="title">{m.hello}</T><T>{session.user.name}</T><T>{m.greeting}</T></View><Button label={m.connection} onPress={() => navigate('connection')} /></Row>
          <Card style={{ padding: 24 }}><Row style={{ flexWrap: 'nowrap' }}><Mark size={dimensions.width < 380 ? 72 : 92} /><View style={{ flex: 1 }}><T variant="label">AETHER / 01</T><T variant="heading">{m.feature}</T></View></Row><Button primary label={media.active ? m.returnSession : m.start} icon="mic" onPress={() => start()} /></Card>
          <T variant="heading">{m.quick}</T><T variant="small">{m.quickHint}</T>
          <ScrollView horizontal contentContainerStyle={{ flexDirection: language === 'ar' ? 'row-reverse' : 'row', paddingVertical: 20, paddingHorizontal: 8, gap: fan ? 0 : 12, minHeight: fan ? 220 : undefined }} showsHorizontalScrollIndicator={!fan}>
            {m.questions.map((question, index) => <Pressable key={question} accessibilityRole="button" accessibilityLabel={question} accessibilityState={{ selected: selected === index }} onPress={() => setSelected(index)} style={{ width: 118, minHeight: 160, padding: 12, borderWidth: selected === index ? 2 : 1, borderColor: selected === index ? colors.ink : colors.muted, borderRadius: 10, backgroundColor: colors.card, gap: 12, marginLeft: fan && index > 0 ? -52 : 0, zIndex: selected === index ? 10 : 5 - Math.abs(selected - index), transform: fan ? [{ rotate: `${(index - 2) * (language === 'ar' ? -5 : 5)}deg` }, { translateY: Math.abs(index - 2) * 6 + (selected === index ? -10 : 0) }] : [] }}><T variant="label">{String(index + 1).padStart(2, '0')}                     Q</T><Icon name={(['eye', 'search', 'history', 'arrow-right', 'sparkles'] as const)[index]} color={colors.ink} /><T style={{ fontSize: 13 }}>{question}</T></Pressable>)}
          </ScrollView>
          <Card style={{ backgroundColor: colors.inset }}><T variant="label">{m.selected}</T><T>{m.questions[selected]}</T><Button primary label={m.ask} onPress={() => start(selected)} /><T variant="small">{m.say}</T></Card>
          <Row><T variant="heading" style={{ flex: 1 }}>{m.recent}</T><Button label={m.viewHistory} onPress={() => navigate('history')} /></Row>
          {history.loading ? <T>{u.loading}</T> : history.items[0] ? <Card><T variant="small">{entryTime(history.items[0], language)}</T><T language={history.items[0].language}>{history.items[0].question}</T><Button label={m.viewHistory} onPress={() => navigate('history')} /></Card> : <><T>{m.noQuestions}</T><T variant="small">{m.noQuestionsBody}</T></>}
          {history.error && <Notice danger>{u.storageError}</Notice>}
        </View>}
        {page === 'assistant' && <View style={{ gap: 20 }}><Notice>{n.demoExplanation}</Notice>
          <View style={{ height: media.active ? 230 : 330, borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.inset }}>
            {runtime.caps.go && <GoCameraPreview camera={runtime.camera} />}{runtime.caps.webrtc && media.cameraUrl && <RtcPreview url={media.cameraUrl} />}
            {!media.active ? <Pressable accessibilityRole="button" accessibilityLabel={m.startLabel} onPress={() => start(prompt)} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, padding: 24 }}><Mark size={130} /><T variant="heading">{m.tap}</T><T variant="small">{m.idleHint}</T></Pressable> : <View pointerEvents="none" style={{ padding: 12, gap: 12 }}><T style={{ color: 'white', backgroundColor: '#202020', padding: 8 }}>{media.camera ? media.transport === 'connected' ? n.transportConnected : m.cameraPreview : media.phase === 'starting' ? m.preparing : m.voiceOnly}</T></View>}
          </View>
          <T accessibilityLiveRegion={media.phase === 'speaking' || media.phase === 'hearing' ? 'none' : 'polite'} variant="heading">{phase}</T>
          {media.phase === 'paused' && media.active && <Button label={m.resume} onPress={() => runtime.controller.resume()} />}
          {prompt !== null && <Card><T variant="label">{m.selected}</T><T>{m.questions[prompt]}</T><T variant="small">{m.say}</T></Card>}
          {!!media.transcript && <Card><T variant="label">{m.transcript}</T><T>{media.transcript}</T></Card>}
          {media.answer && <Reveal key={media.answer.id}><View style={{ borderTopWidth: 8, borderTopColor: '#2A2A2E', gap: 20 }}><Card style={{ marginHorizontal: 8, borderRadius: 0 }}><T variant="label">AETHER · {m.answer}</T><T variant="small">{entryTime(media.answer, language)}</T><Notice>{m.demo}</Notice>{media.answer.input === 'typed' && <T variant="small">{n.typed}</T>}<T language={media.answer.language}>{media.answer.answer}</T><T variant="small">{m.evidence} · {media.answer.language.toUpperCase()}</T></Card><Cassette onReplay={() => { void runtime.controller.replay(media.answer!); }} /></View></Reveal>}
          {media.phase === 'speaking' && <Button label={n.stopSpeech} onPress={() => runtime.controller.stopPlayback()} />}
          {(!runtime.caps.recognition || !runtime.caps.webrtc) && <Notice>{n.native_required}</Notice>}
          {runtime.caps.go && __DEV__ && media.active && <Card><T variant="small">{n.typed}</T><Field label={n.typedLabel} value={typed} onChangeText={setTyped} /><Button label={n.typedAction} disabled={!typed.trim() || ['speaking', 'processing', 'paused'].includes(media.phase)} onPress={() => { void runtime.controller.typedQuestion(typed); setTyped(''); }} /></Card>}
          {[media.cameraError, media.voiceError, media.error].filter(Boolean).map(code => <Notice key={code} danger>{n[code as keyof typeof n] as string || n.error}</Notice>)}
          {media.transport === 'failed' && <Notice danger>{n.transportFailed}</Notice>}{media.registry === 'failed' && <Notice danger>{n.registry_failed}</Notice>}
          {runtime.caps.webrtc && <T variant="small">{n.noSnapshot}</T>}
        </View>}
        {page === 'history' && <HistoryScreen repository={runtime.repository} state={history} replay={entry => { void runtime.controller.replay(entry); }} active={media.active} speaking={media.phase === 'speaking'} stopSpeech={() => runtime.controller.stopPlayback()} focus={focus} />}
        {page === 'settings' && <View style={{ gap: 24 }}><T variant="title">{m.settings}</T><T variant="heading">{m.voice}</T><Card><T>{m.speed}</T><Button disabled label={m.speedValue} onPress={() => {}} /><T variant="small">{m.voiceIntegration}</T><T>{m.aloud}</T><T variant="small">{n.aloudNote}</T>
          {([['haptics', m.vibrate, m.vibrateNote], ['motion', m.motion, m.motionNote]] as const).map(([key, label, body]) => <View key={key} style={{ gap: 8 }}><Row><T style={{ flex: 1 }}>{label}</T><Switch accessibilityLabel={label} value={key === 'motion' ? preferences.motion !== false : preferences.haptics === true} onValueChange={value => updatePrefs({ [key]: value })} /></Row><T variant="small">{body}</T></View>)}<T>{m.warning}</T><T variant="small">{m.warningNote}</T></Card>
          <T variant="heading">{m.local}</T><Card><T>{n.retention}</T><HoldButton clear disabled={history.loading || !history.items.length} onConfirm={() => { runtime.repository.clear(); setNotice(u.cleared); }} onOptions={() => setConfirm('clear')} /><T variant="small">{m.clearHint}</T></Card>
          <Button label={m.connection} onPress={() => navigate('connection')} /><Button label={m.how} onPress={() => navigate('help')} /><Card><T variant="heading">{m.account}</T><T>{session.user.name}</T><T selectable style={{ writingDirection: 'ltr' }}>{session.user.email}</T><T variant="small">{n.accountNote}</T><Button danger label={m.signOut} onPress={() => setConfirm('logout')} /></Card>
        </View>}
        {page === 'help' && <HelpScreen />}{page === 'connection' && <ConnectionScreen endpoints={endpoints} onSave={saveEndpoints} signedIn session={media} />}
        {!!notice && <Notice>{notice}</Notice>}
      </>}
    </Frame>
    {confirm && <Sheet restoreFocus={focus} title={confirm === 'logout' ? u.signOutTitle : confirm === 'clear' ? m.clearTitle : confirm === 'leave' ? m.leaveTitle : m.stopTitle} onClose={() => setConfirm(null)}><T>{confirm === 'logout' ? u.signOutBody : confirm === 'clear' ? n.clearBody : m.stopBody}</T><Button label={m.cancel} onPress={() => setConfirm(null)} /><Button danger label={confirm === 'logout' ? m.signOut : confirm === 'clear' ? m.clear : m.stop} onPress={confirmAction} /></Sheet>}
  </UIContext.Provider>;
}
