import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, Dimensions, ScrollView, Switch, Vibration, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Account } from '../src/screens/Account';
import { AuthController } from '../src/auth/authController';
import { defaultEndpoints } from '../src/platform/config';
import { sessionHaptics } from '../src/platform/sessionHaptics';
import { Button, Card, HoldButton, Notice, Sheet, UIContext } from '../src/components/ui';
import { light, dark } from '../src/theme/tokens';
import { monoCopy } from '../src/i18n/monoCopy';
import { copies, nativeCopy } from '../src/i18n/nativeCopy';
import { sessionGreeting } from '../src/voice/sessionGreeting';
import { voiceCopy } from '../src/i18n/voiceCopy';
import type { RecognitionEvents } from '../src/session/controller';
import type { Language } from '../src/shared/types';

jest.mock('../src/services/teamApi', () => ({ createTeamApi: () => ({ ask: async (request: { question_id: string; language: Language }) => ({ ...request, answer: 'Synthetic server answer', uncertain: false, evidence_frame_ids: [] }) }) }));

const mockOrder: string[] = [], mockRelease = jest.fn();
const mockCheckVoice = jest.fn();
let mockAudioAvailable = true;
let mockWake: RecognitionEvents | undefined, mockQuestion: RecognitionEvents | undefined;
jest.mock('../src/platform/capabilities', () => ({ capabilities: () => ({ go: false, recognition: true, webrtc: true }), apiVoiceAvailable: () => mockAudioAvailable }));
jest.mock('../src/voice/apiClient', () => ({ ...jest.requireActual('../src/voice/apiClient'), createVoiceApi: () => ({ check: mockCheckVoice }) }));
jest.mock('../src/voice/cloudVoice', () => ({ CloudVoice: class {
  error = '';
  prepare = async () => { mockOrder.push('cloud prepare'); };
  recognize = async (_: Language, events: RecognitionEvents) => { mockOrder.push('cloud record'); events.start(); return async () => {}; };
  speak = async (_: string, __: Language, started: () => void) => { mockOrder.push('cloud speak'); started(); return 'done'; };
  stop = () => {};
} }));
jest.mock('../src/platform/camera', () => ({
  GoCamera: class {}, GoCameraPreview: () => null, RtcPreview: () => null,
  nativeCamera: async () => { mockOrder.push('camera'); return { url: 'native-test-camera', release: mockRelease }; },
  nativePublisher: (_: unknown, __: unknown, state: (value: string) => void) => ({ start: async () => state('connected'), stop() {} }),
}));
jest.mock('../src/voice/recognition', () => ({
  prepareRecognition: async () => {},
  recognize: async (_: Language, events: RecognitionEvents, __: AbortSignal, options?: { onDevice?: boolean }) => {
    if (options?.onDevice) { mockWake = events; mockOrder.push('wake'); }
    else { mockQuestion = events; mockOrder.push('question'); }
    events.start(); return async () => { mockOrder.push(options?.onDevice ? 'wake stopped' : 'question stopped'); };
  },
}));

const user = { user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'UI QA', email: 'qa@example.test', created_at: new Date().toISOString() };
const cleanup = new Set<() => Promise<void>>();
afterEach(async () => { for (const close of cleanup) await close(); cleanup.clear(); jest.restoreAllMocks(); });
async function press(tree: renderer.ReactTestRenderer, label: string) {
  const surface = tree.root.findAllByType(Sheet).at(-1) ?? tree.root;
  const button = surface.findAllByType(Button).find(item => item.props.label === label); expect(button).toBeDefined();
  await act(async () => button!.props.onPress());
}
async function tab(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAll(item => item.props.accessibilityRole === 'tab' && item.props.accessibilityLabel === label && item.props.onPress)[0];
  await act(async () => button.props.onPress());
}
async function setup(language: Language = 'en', darkMode = false) {
  const auth = new AuthController({ me: async () => user, login: async () => user, signup: async () => user, logout: async () => {} }, 'session-ui-' + language); await auth.check();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 59, bottom: 34, left: 0, right: 0 } }}><UIContext.Provider value={{ language, colors: darkMode ? dark : light, fonts: false, motion: false, haptics: false }}><Account auth={auth} session={auth.getSnapshot().session!} endpoints={defaultEndpoints} saveEndpoints={() => {}} changeLanguage={() => {}} themeMode={darkMode ? 'dark' : 'light'} changeTheme={() => {}} /></UIContext.Provider></SafeAreaProvider>); });
  const close = async () => { await act(async () => tree.unmount()); auth.dispose(); cleanup.delete(close); };
  cleanup.add(close);
  await press(tree, copies(language).m.getStarted);
  return { tree, auth, close };
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); mockOrder.length = 0; mockWake = undefined; mockQuestion = undefined;
  mockAudioAvailable = true; mockCheckVoice.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  Dimensions.set({ window: { width: 402, height: 874, scale: 3, fontScale: 1 } });
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => { mockOrder.push('vibrate'); });
  (Speech.speak as jest.Mock).mockImplementation((_text, options) => { mockOrder.push('greet'); options.onStart?.(); options.onDone?.(); });
});

test.each(['en', 'ar'] as const)('Hey Aether opens one session, pulses before camera, greets, then listens: %s', async language => {
  const { tree, close } = await setup(language, language === 'ar'), m = monoCopy[language];
  await tab(tree, m.settings);
  for (const label of [m.vibrate, m.wake]) {
    const toggle = tree.root.findAllByType(Switch).find(item => item.props.accessibilityLabel === label)!;
    await act(async () => toggle.props.onValueChange(true));
  }
  expect(mockWake).toBeDefined();
  await act(async () => { mockWake!.result('Hey Aether', false); mockWake!.result('Hey Aether', true); });
  expect(mockOrder).not.toContain('camera');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith(sessionGreeting[language], expect.objectContaining({ language: language === 'ar' ? 'ar-SA' : 'en-US' }));
  expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
  expect(mockOrder.indexOf('wake stopped')).toBeLessThan(mockOrder.indexOf('vibrate'));
  expect(mockOrder.indexOf('vibrate')).toBeLessThan(mockOrder.indexOf('camera'));
  expect(mockOrder.lastIndexOf('vibrate')).toBeLessThan(mockOrder.indexOf('camera'));
  expect(mockOrder.indexOf('greet')).toBeLessThan(mockOrder.indexOf('question'));
  expect(tree.root.findAllByType(Button).filter(item => item.props.label === m.stop)).toHaveLength(1);
  expect(tree.root.findAllByType(HoldButton)).toHaveLength(0);
  const camera = tree.root.findAllByType(View).find(item => item.props.testID === 'camera-viewport')!;
  expect(camera.props.style.height / 874).toBeCloseTo(.84);
  await press(tree, m.stop); expect(mockRelease).toHaveBeenCalledTimes(1);
  await close();
});
test('API voice selection routes the greeting and recording to the cloud adapter and persists per account', async () => {
  const { tree, close } = await setup(), m = monoCopy.en;
  await tab(tree, m.settings);
  const toggle = tree.root.findAllByType(Switch).find(item => item.props.accessibilityLabel === voiceCopy.en.api)!;
  await act(async () => toggle.props.onValueChange(true));
  await tab(tree, m.home); await press(tree, m.start);
  expect(mockOrder).toContain('cloud prepare'); expect(mockOrder).toContain('cloud speak'); expect(mockOrder).toContain('cloud record');
  expect(mockOrder).not.toContain('question'); expect(mockOrder).not.toContain('greet');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(expect.stringContaining(':display'), expect.stringContaining('"apiVoice":true'));
  await close();
});

test.each(['en', 'ar', 'fr'] as const)('voice check shows progress and its result beside the voice controls: %s', async language => {
  let finish!: () => void;
  mockCheckVoice.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const { tree, close } = await setup(language), copy = voiceCopy[language];
  await tab(tree, copies(language).m.settings);
  const check = tree.root.findAllByType(Button).find(button => button.props.label === copy.check)!;
  await act(async () => { check.props.onPress(); check.props.onPress(); });
  expect(mockCheckVoice).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(Button).find(button => button.props.label === copy.checking)?.props.disabled).toBe(true);
  await act(async () => finish());
  const voiceCard = tree.root.findAllByType(Card).find(card => card.findAllByType(Button).some(button => button.props.label === copy.check))!;
  expect(voiceCard.findAllByType(Notice).map(notice => notice.props.children)).toContain(copy.ready);
  expect(tree.root.findAllByType(Button).find(button => button.props.label === copy.check)?.props.disabled).toBe(false);
  await close();
});

test('voice connection errors appear beside the check button and allow retry', async () => {
  mockCheckVoice.mockRejectedValueOnce(new Error('voice_unavailable'));
  const { tree, close } = await setup(), copy = voiceCopy.en;
  await tab(tree, monoCopy.en.settings); await press(tree, copy.check);
  const voiceCard = tree.root.findAllByType(Card).find(card => card.findAllByType(Button).some(button => button.props.label === copy.check))!;
  expect(voiceCard.findAllByType(Notice).some(notice => notice.props.children === copy.voice_unavailable && notice.props.danger)).toBe(true);
  await press(tree, copy.check);
  expect(voiceCard.findAllByType(Notice).map(notice => notice.props.children)).toContain(copy.ready);
  await close();
});

test('leaving Settings cancels the voice check and ignores its late result', async () => {
  let finish!: () => void;
  mockCheckVoice.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const { tree, close } = await setup();
  await tab(tree, monoCopy.en.settings); await press(tree, voiceCopy.en.check);
  const signal: AbortSignal = mockCheckVoice.mock.calls[0][0];
  await tab(tree, monoCopy.en.home); expect(signal.aborted).toBe(true);
  await act(async () => finish());
  await tab(tree, monoCopy.en.settings);
  expect(JSON.stringify(tree.toJSON())).not.toContain(voiceCopy.en.ready);
  expect(tree.root.findAllByType(Button).find(button => button.props.label === voiceCopy.en.check)?.props.disabled).toBe(false);
  await close();
});

test('missing audio module feedback appears beside the API voice switch', async () => {
  mockAudioAvailable = false;
  const { tree, close } = await setup();
  await tab(tree, monoCopy.en.settings);
  const toggle = tree.root.findAllByType(Switch).find(item => item.props.accessibilityLabel === voiceCopy.en.api)!;
  await act(async () => toggle.props.onValueChange(true));
  const voiceCard = tree.root.findAllByType(Card).find(card => card.findAllByType(Switch).some(item => item.props.accessibilityLabel === voiceCopy.en.api))!;
  expect(voiceCard.findAllByType(Notice).map(notice => notice.props.children)).toContain(voiceCopy.en.voice_native_required);
  expect(toggle.props.value).toBe(false);
  await close();
});

test('manual Start greets with vibration disabled; stopping prevents any second greeting', async () => {
  const { tree, close } = await setup();
  await press(tree, monoCopy.en.start);
  expect(Vibration.vibrate).not.toHaveBeenCalled(); expect(Speech.speak).toHaveBeenCalledTimes(1);
  await press(tree, monoCopy.en.stop); expect(Speech.speak).toHaveBeenCalledTimes(1); expect(mockRelease).toHaveBeenCalledTimes(1);
  await close();
});

test('a question after the greeting produces an answer, opens its full text, and stops from one control', async () => {
  const { tree, close } = await setup();
  await press(tree, monoCopy.en.start);
  expect(mockQuestion).toBeDefined();
  await act(async () => mockQuestion!.result('Read the sign', true, .95));
  expect(Speech.speak).toHaveBeenCalledTimes(2);
  await press(tree, monoCopy.en.answer);
  expect(JSON.stringify(tree.toJSON())).toContain('Synthetic server answer');
  await press(tree, monoCopy.en.close); await press(tree, monoCopy.en.stop);
  expect(mockRelease).toHaveBeenCalledTimes(1); await close();
});

test.each([
  ['en', 375, 667, 1], ['ar', 402, 874, 1], ['en', 402, 874, 2], ['ar', 402, 874, 2], ['ar', 874, 402, 2],
] as const)('camera and controls adapt to %s at %sx%s, font scale %s', async (language, width, height, fontScale) => {
  Dimensions.set({ window: { width, height, scale: 3, fontScale } });
  const { tree, close } = await setup(language, language === 'ar'), m = monoCopy[language];
  await press(tree, m.start);
  const screen = tree.root.findAllByType(View).find(item => item.props.testID === 'assistant-screen')!;
  await act(async () => screen.props.onLayout({ nativeEvent: { layout: { width, height } } }));
  const camera = tree.root.findAllByType(View).find(item => item.props.testID === 'camera-viewport')!;
  const controls = tree.root.findAllByType(ScrollView).find(item => item.props.testID === 'session-controls')!;
  expect(camera.props.style.height + controls.props.style.height).toBe(height);
  expect(controls.props.style.height).toBeGreaterThanOrEqual(56 * fontScale + 34 + 16);
  expect(controls.findAllByType(Button).filter(item => item.props.label === m.stop)).toHaveLength(1);
  await press(tree, m.back); await press(tree, m.cancel); expect(mockRelease).not.toHaveBeenCalled();
  await press(tree, m.back); await press(tree, m.stop); expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).toContain(m.quick); await close();
});

test('History, Settings and Home omit repeated storage notes and unavailable settings', async () => {
  const { tree, close } = await setup(), m = monoCopy.en;
  for (const screen of [m.home, m.history, m.settings]) {
    await tab(tree, screen); const json = JSON.stringify(tree.toJSON());
    for (const text of [nativeCopy.en.privacy, nativeCopy.en.retention, m.voiceIntegration, m.warningNote, m.accountNote]) expect(json).not.toContain(text);
  }
  await close();
});

test('unsupported haptics do not break the session and disabled preference never requests them', async () => {
  await sessionHaptics(false); expect(Vibration.vibrate).not.toHaveBeenCalled();
  jest.mocked(Vibration.vibrate).mockImplementationOnce(() => { throw Error('not supported'); });
  await expect(sessionHaptics(true)).resolves.toBeUndefined();
});
