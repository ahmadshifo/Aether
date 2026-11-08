import React, { useSyncExternalStore } from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Dimensions, Pressable, Share, TextInput, View } from 'react-native';
import { UIContext, Button, HoldButton, Sheet } from '../src/components/ui';
import { monoCopy } from '../src/i18n/monoCopy';
import { uiCopy } from '../src/i18n/uiCopy';
import { authCopy } from '../src/i18n/authCopy';
import { nativeCopy } from '../src/i18n/nativeCopy';
import { teamCopy } from '../src/i18n/teamCopy';
import { ProfileSettings } from '../src/components/ProfileSettings';
import { light, dark, geometry } from '../src/theme/tokens';
import { AuthScreen } from '../src/screens/AuthScreen';
import { ConnectionScreen } from '../src/screens/ConnectionScreen';
import { HelpScreen } from '../src/screens/HelpScreen';
import { Account } from '../src/screens/Account';
import { AuthController } from '../src/auth/authController';
import { defaultEndpoints } from '../src/platform/config';
import { capabilities, loadRecognition, loadRtc } from '../src/platform/capabilities';
import { SpeechOwner } from '../src/voice/speech';
import * as Speech from 'expo-speech';
import * as Clipboard from 'expo-clipboard';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { historyStreamCopy } from '../src/i18n/historyStreamCopy';
import { HistoryRepository } from '../src/storage/history';
import { HistorySync } from '../src/storage/historySync';
import type { Language } from '../src/shared/types';
const user = { user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Synthetic test account', email: 'test@example.test', created_at: new Date().toISOString() };
const wrapper = (children: React.ReactNode, language: Language = 'en', colors = light) => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 59, bottom: 34, left: 0, right: 0 } }}><UIContext.Provider value={{ language, colors, fonts: false, motion: false, haptics: false }}>{children}</UIContext.Provider></SafeAreaProvider>;
async function render(element: React.ReactNode) { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(element); }); return tree; }
async function press(tree: renderer.ReactTestRenderer, label: string) { const item = tree.root.findAllByType(Button).find(x => x.props.label === label); expect(item).toBeTruthy(); await act(async () => { item!.props.onPress(); }); }
afterEach(() => jest.clearAllMocks());
test('EN/AR key parity, source theme values and native hit targets', () => {
  const keys = (obj: Record<string, unknown>, prefix = ''): string[] => Object.entries(obj).flatMap(([k, v]) => typeof v === 'object' && v && !Array.isArray(v) ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]).sort();
  for (const dictionary of [monoCopy, uiCopy, authCopy, nativeCopy, teamCopy]) expect(keys(dictionary.en)).toEqual(keys(dictionary.ar));
  expect(light.bg).toBe('#FCFCFC'); expect(light.ink).toBe('#202020'); expect(dark.bg).toBe('#141414'); expect(geometry.hit).toBeGreaterThanOrEqual(48);
});
test('Expo Go module gating blocks custom module evaluation', () => {
  expect(capabilities().webrtc).toBe(false); expect(capabilities().recognition).toBe(false);
  expect(() => loadRtc()).toThrow('native_required'); expect(() => loadRecognition()).toThrow('native_required');
});
test.each(['en', 'ar'] as const)('auth landing/forms/outage remain native and translated: %s', async language => {
  const a = authCopy[language], state = { status: 'signed_out' as const, session: null, error: '', notice: '' };
  const tree = await render(wrapper(<AuthScreen state={state} retry={() => {}} connection={() => {}} help={() => {}} />, language));
  await press(tree, monoCopy[language].signup); expect(tree.root.findAllByType(TextInput)).toHaveLength(4);
  await press(tree, a.signup); expect(JSON.stringify(tree.toJSON())).toContain(a.errors.invalid_email);
  await act(async () => { tree.update(wrapper(<AuthScreen state={{ ...state, status: 'service_unavailable', error: 'backend_unavailable' }} retry={() => {}} connection={() => {}} help={() => {}} />, language)); });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(JSON.stringify(tree.toJSON())).toContain(nativeCopy[language].backend_unavailable);
  await act(async () => tree.unmount());
});
test.each(['en', 'ar'] as const)('eight screen families use shared native views and working navigation: %s', async language => {
  Dimensions.set({ window: { width: language === 'ar' ? 412 : 402, height: language === 'ar' ? 915 : 874, scale: 3, fontScale: 2 } });
  const auth = new AuthController({ me: async () => user, login: async () => user, signup: async () => user, logout: async () => {} }, 'test-ui-' + language); await auth.check();
  const tree = await render(wrapper(<Account auth={auth} session={auth.getSnapshot().session!} endpoints={defaultEndpoints} saveEndpoints={() => {}} changeLanguage={() => {}} themeMode="system" changeTheme={() => {}} />, language));
  const m = monoCopy[language]; expect(JSON.stringify(tree.toJSON())).toContain(m.welcome);
  await press(tree, m.getStarted); expect(JSON.stringify(tree.toJSON())).toContain(m.quick);
  const go = async (label: string) => { const tab = tree.root.findAll(x => x.props.accessibilityRole === 'tab' && x.props.accessibilityLabel === label && typeof x.props.onPress === 'function')[0]; expect(tab).toBeTruthy(); await act(async () => tab!.props.onPress()); };
  await go(m.history); expect(JSON.stringify(tree.toJSON())).toContain(uiCopy[language].emptyTitle);
  await go(m.settings); expect(JSON.stringify(tree.toJSON())).toContain(user.email);
  await press(tree, m.connection); expect(tree.root.findAllByType(TextInput)).toHaveLength(2);
  await go(m.help); expect(JSON.stringify(tree.toJSON())).toContain(m.safety);
  await go(m.home); await press(tree, m.start);
  expect(tree.root.findAllByType(Pressable).filter(x => x.props.accessibilityRole === 'tab')).toHaveLength(0);
  expect(tree.root.findAllByType(Button).filter(x => x.props.label === m.stop)).toHaveLength(1);
  expect(tree.root.findAllByType(HoldButton)).toHaveLength(0);
  await press(tree, nativeCopy[language].details); expect(JSON.stringify(tree.toJSON())).toContain(nativeCopy[language].native_required);
  await press(tree, m.close); await press(tree, m.stop);
  expect(tree.root.findAllByType(Button).filter(x => x.props.label === m.stop)).toHaveLength(0);
  await act(async () => tree.unmount()); auth.dispose();
});
test('public Connection and Help expose setup/safety with no personal account data', async () => {
  const connection = await render(wrapper(<ConnectionScreen endpoints={defaultEndpoints} onSave={() => {}} signedIn={false} />));
  expect(connection.root.findAllByType(TextInput)).toHaveLength(2); expect(JSON.stringify(connection.toJSON())).not.toContain(user.email);
  const help = await render(wrapper(<HelpScreen />)); expect(JSON.stringify(help.toJSON())).toContain(nativeCopy.en.osSpeech);
  await act(async () => { connection.unmount(); help.unmount(); });
});
test('profile edits use the team API and cancel pending work when the account locks', async () => {
  const auth = new AuthController({ me: async () => user, login: async () => user, signup: async () => user, logout: async () => {} }, 'team'); await auth.check();
  const session = auth.getSnapshot().session!;
  let signal: AbortSignal | undefined, resolve: ((value: typeof user) => void) | undefined;
  const api = { ask: jest.fn(), updateName: jest.fn((_name: string, _id: string, value: AbortSignal) => { signal = value; return new Promise<typeof user>(done => { resolve = done; }); }) };
  const tree = await render(wrapper(<ProfileSettings auth={auth} session={session} api={api} />));
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Updated name'));
  await press(tree, teamCopy.en.saveName); expect(api.updateName).toHaveBeenCalledWith('Updated name', user.user_id, expect.anything());
  await act(async () => { auth.background(); resolve!({ ...user, name: 'Late name' }); });
  expect(signal!.aborted).toBe(true); expect(auth.getSnapshot().session!.user.name).toBe(user.name);
  await act(async () => tree.unmount()); auth.dispose();
});
test('one device speech owner selects answer language, uses actual callbacks and rejects late voice lookup', async () => {
  const owner = new SpeechOwner(), started = jest.fn();
  expect(await owner.speak('Synthetic answer', 'en', started)).toBe('done'); expect(started).toHaveBeenCalledTimes(1);
  expect(await owner.speak('مثال', 'ar', started)).toBe('done'); expect(Speech.speak).toHaveBeenLastCalledWith('مثال', expect.objectContaining({ language: 'ar-SA' }));
  let resolve!: (value: unknown[]) => void; (Speech.getAvailableVoicesAsync as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = owner.speak('Cancelled', 'en', started); await Promise.resolve(); await Promise.resolve(); owner.stop(); resolve([{ identifier: 'test', language: 'en-US' }]); expect(await pending).toBe('cancelled');
});

test('History detail preserves Arabic, explicitly copies/shares, and Clear confirmation invalidates Undo', async () => {
  const repository = new HistoryRepository({ userId: user.user_id, source: 'history-ui-test', epoch: 1 }, { read: async () => null, write: async () => {}, collect: async () => {} }, () => true);
  await repository.ready;
  const entry = { id: 'one', sessionId: 'session', questionId: 'question', language: 'ar' as const, question: 'اقرأ اللافتة', answer: 'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.', input: 'speech' as const, provenance: 'server' as const, uncertain: false, evidenceFrameIds: [], createdAt: new Date().toISOString() };
  repository.upsert(entry);
  const replay = jest.fn(), stopSpeech = jest.fn(), make = () => wrapper(<HistoryScreen repository={repository} state={repository.getSnapshot()} replay={replay} active={false} speaking stopSpeech={stopSpeech} focus={() => {}} />);
  const tree = await render(make()), u = uiCopy.en;
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  await press(tree, u.readMore); expect(JSON.stringify(tree.toJSON())).toContain(entry.answer); expect(JSON.stringify(tree.toJSON())).toContain(u.noPhoto);
  await press(tree, u.copy); expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining(entry.answer));
  const shared = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  await press(tree, u.share); expect(JSON.stringify(tree.toJSON())).toContain(nativeCopy.en.shareCancelled); shared.mockRestore();
  await press(tree, nativeCopy.en.stopSpeech); expect(stopSpeech).toHaveBeenCalledTimes(1);
  await press(tree, historyStreamCopy.en.removeLocal); await act(async () => tree.update(make())); expect(repository.getSnapshot().undo?.id).toBe('one');
  await press(tree, u.undo); await act(async () => tree.update(make())); expect(repository.getSnapshot().items).toHaveLength(1);
  await press(tree, u.clear); await press(tree, u.cancel); expect(repository.getSnapshot().items).toHaveLength(1);
  await press(tree, u.clear);
  const confirm = tree.root.findByType(Sheet).findAllByType(Button).find(button => button.props.label === u.clear)!;
  await act(async () => confirm.props.onPress()); await act(async () => tree.update(make()));
  expect(repository.getSnapshot().items).toHaveLength(0); expect(repository.getSnapshot().undo).toBeNull();
  await act(async () => tree.unmount()); repository.dispose();
});

test('timed Stop requires release inside; leaving cancels; normal accessibility action opens confirmation', async () => {
  const confirm = jest.fn(), options = jest.fn(), tree = await render(wrapper(<HoldButton onConfirm={confirm} onOptions={options} />));
  const gesture = tree.root.findAllByType(View).find(view => view.props.onResponderRelease)!;
  await act(async () => gesture.props.onLayout({ nativeEvent: { layout: { width: 200, height: 92 } } }));
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  await act(async () => gesture.props.onResponderGrant()); now.mockReturnValue(2200);
  await act(async () => gesture.props.onResponderMove({ nativeEvent: { locationX: 250, locationY: 40 } }));
  await act(async () => gesture.props.onResponderRelease({ nativeEvent: { locationX: 40, locationY: 40 } })); expect(confirm).not.toHaveBeenCalled();
  now.mockReturnValue(3000); await act(async () => gesture.props.onResponderGrant()); now.mockReturnValue(4100);
  await act(async () => gesture.props.onResponderRelease({ nativeEvent: { locationX: 40, locationY: 40 } })); expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => gesture.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })); expect(options).toHaveBeenCalledTimes(1);
  now.mockRestore(); await act(async () => tree.unmount());
});

test.each(['en', 'ar', 'fr'] as const)('account History keeps cached answers offline, retries pages and confirms server deletion: %s', async language => {
  const repository = new HistoryRepository({ userId: user.user_id, source: `history-sync-ui-${language}`, epoch: 1 }, { read: async () => null, write: async () => {}, collect: async () => {} }, () => true);
  await repository.ready;
  const entry = { id: 'cached', sessionId: 's', questionId: 'q', language, question: 'Cached question', answer: 'Cached answer', input: 'speech' as const, provenance: 'server' as const, uncertain: false, evidenceFrameIds: [], createdAt: new Date(Date.now() - 10000).toISOString() };
  repository.upsert(entry);
  let offline = true, resolveDelete!: (value: number) => void;
  const deleted = new Promise<number>(resolve => { resolveDelete = resolve; });
  const api = { page: jest.fn(async (cursor: string | null) => {
    if (offline) throw Error('offline');
    return { entries: cursor ? [{ ...entry, id: 'older', questionId: 'older', question: 'Older question' }] : [entry], nextCursor: cursor ? null : 'next', demo: false };
  }), clear: jest.fn(() => deleted) };
  const sync = new HistorySync(repository, api, () => true), stop = jest.fn();
  function Screen() {
    const local = useSyncExternalStore(repository.subscribe, repository.getSnapshot), network = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
    return <HistoryScreen repository={repository} state={{ ...local, items: network.items }} sync={sync} network={network} stopSession={stop} replay={() => {}} active speaking={false} stopSpeech={() => {}} focus={() => {}} />;
  }
  const tree = await render(wrapper(<Screen />, language)), h = historyStreamCopy[language];
  await act(async () => sync.refresh());
  expect(JSON.stringify(tree.toJSON())).toContain(h.offline); expect(JSON.stringify(tree.toJSON())).toContain(entry.question);
  offline = false; await press(tree, h.retry); await press(tree, h.more);
  expect(api.page).toHaveBeenLastCalledWith('next', expect.anything()); expect(JSON.stringify(tree.toJSON())).toContain('Older question');
  await press(tree, h.clear); expect(api.clear).not.toHaveBeenCalled(); expect(tree.root.findByType(Sheet).props.title).toBe(h.clearTitle);
  const confirm = tree.root.findByType(Sheet).findAllByType(Button).find(button => button.props.label === h.clear)!;
  await act(async () => confirm.props.onPress());
  expect(stop).toHaveBeenCalledTimes(1); expect(api.clear).toHaveBeenCalledTimes(1); expect(confirm.props.disabled).toBe(true); expect(repository.getSnapshot().items).toHaveLength(2);
  await act(async () => resolveDelete(2)); expect(repository.getSnapshot().items).toHaveLength(0); expect(JSON.stringify(tree.toJSON())).toContain(h.cleared);
  await act(async () => tree.unmount()); sync.dispose(); repository.dispose();
});
