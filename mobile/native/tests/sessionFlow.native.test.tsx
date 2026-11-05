import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, Dimensions, ScrollView, Switch, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Account } from '../src/screens/Account';
import { AuthController } from '../src/auth/authController';
import { defaultEndpoints } from '../src/platform/config';
import { sessionHaptics } from '../src/platform/sessionHaptics';
import { Button, HoldButton, Sheet, UIContext } from '../src/components/ui';
import { light, dark } from '../src/theme/tokens';
import { monoCopy } from '../src/i18n/monoCopy';
import { nativeCopy } from '../src/i18n/nativeCopy';
import { sessionGreeting } from '../src/voice/sessionGreeting';
import type { RecognitionEvents } from '../src/session/controller';
import type { Language } from '../src/shared/types';

const mockOrder: string[] = [], mockRelease = jest.fn();
let mockWake: RecognitionEvents | undefined, mockQuestion: RecognitionEvents | undefined;
jest.mock('../src/platform/capabilities', () => ({ capabilities: () => ({ go: false, recognition: true, webrtc: true }) }));
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
afterEach(async () => { for (const close of cleanup) await close(); cleanup.clear(); });
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
  await press(tree, monoCopy[language].getStarted);
  const close = async () => { await act(async () => tree.unmount()); auth.dispose(); cleanup.delete(close); };
  cleanup.add(close);
  return { tree, auth, close };
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); mockOrder.length = 0; mockWake = undefined; mockQuestion = undefined;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  Dimensions.set({ window: { width: 402, height: 874, scale: 3, fontScale: 1 } });
  (Haptics.notificationAsync as jest.Mock).mockImplementation(async () => { mockOrder.push('vibrate'); });
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
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith(sessionGreeting[language], expect.objectContaining({ language: language === 'ar' ? 'ar-SA' : 'en-US' }));
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expect(mockOrder.indexOf('wake stopped')).toBeLessThan(mockOrder.indexOf('vibrate'));
  expect(mockOrder.indexOf('vibrate')).toBeLessThan(mockOrder.indexOf('camera'));
  expect(mockOrder.indexOf('greet')).toBeLessThan(mockOrder.indexOf('question'));
  expect(tree.root.findAllByType(Button).filter(item => item.props.label === m.stop)).toHaveLength(1);
  expect(tree.root.findAllByType(HoldButton)).toHaveLength(0);
  const camera = tree.root.findAllByType(View).find(item => item.props.testID === 'camera-viewport')!;
  expect(camera.props.style.height / 874).toBeCloseTo(.84);
  await press(tree, m.stop); expect(mockRelease).toHaveBeenCalledTimes(1);
  await close();
});

test('manual Start greets with vibration disabled; stopping prevents any second greeting', async () => {
  const { tree, close } = await setup();
  await press(tree, monoCopy.en.start);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled(); expect(Speech.speak).toHaveBeenCalledTimes(1);
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
  expect(JSON.stringify(tree.toJSON())).toContain('The sign on the door reads Room 205.');
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
  await sessionHaptics(false); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  (Haptics.notificationAsync as jest.Mock).mockRejectedValueOnce(Error('not supported'));
  await expect(sessionHaptics(true)).resolves.toBeUndefined();
});
