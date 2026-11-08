import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, AppState, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { FirstUseGate, SAFETY_KEY } from '../src/components/FirstUseGate';
import { Button, UIContext } from '../src/components/ui';
import { safetyCopy } from '../src/i18n/safetyCopy';
import { copies } from '../src/i18n/nativeCopy';
import { AuthScreen } from '../src/screens/AuthScreen';
import { HelpScreen } from '../src/screens/HelpScreen';
import { light } from '../src/theme/tokens';
import type { Language } from '../src/shared/types';
const roots: renderer.ReactTestRenderer[] = [];
const wrap = (child: React.ReactNode, language: Language = 'fr') => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 20, bottom: 20, left: 0, right: 0 } }}><UIContext.Provider value={{ language, colors: light, fonts: false, motion: false, haptics: false }}>{child}</UIContext.Provider></SafeAreaProvider>;
async function render(child: React.ReactNode) { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(child); }); roots.push(tree); return tree; }
async function press(tree: renderer.ReactTestRenderer, label: string) { await act(async () => { await tree.root.findAllByType(Button).find(b => b.props.label === label)!.props.onPress(); }); }
const gate = (language: Language = 'fr') => wrap(<FirstUseGate changeLanguage={() => {}}><Text>PRIVATE APP</Text></FirstUseGate>, language);
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  (Speech.getAvailableVoicesAsync as jest.Mock).mockResolvedValue([{ identifier: 'fr-test', language: 'fr-FR' }, { identifier: 'en-test', language: 'en-US' }, { identifier: 'ar-test', language: 'ar-SA' }]);
});
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); jest.restoreAllMocks(); });
test.each(['en', 'ar', 'fr'] as const)('first use blocks the app, reads the notice and persists explicit acknowledgement: %s', async language => {
  const tree = await render(gate(language));
  expect(JSON.stringify(tree.toJSON())).not.toContain('PRIVATE APP');
  expect(Speech.speak).toHaveBeenCalledWith(safetyCopy[language].body, expect.objectContaining({ language: expect.stringContaining(language) }));
  await press(tree, safetyCopy[language].accept);
  expect(await AsyncStorage.getItem(SAFETY_KEY)).toBe('acknowledged');
  expect(JSON.stringify(tree.toJSON())).toContain('PRIVATE APP');
  (Speech.speak as jest.Mock).mockClear();
  const reopened = await render(gate(language));
  expect(JSON.stringify(reopened.toJSON())).toContain('PRIVATE APP'); expect(Speech.speak).not.toHaveBeenCalled();
});
test('failed acknowledgement save keeps the notice visible; a retry succeeds', async () => {
  const tree = await render(gate()); (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk full'));
  await press(tree, safetyCopy.fr.accept); expect(JSON.stringify(tree.toJSON())).toContain(safetyCopy.fr.saveError); expect(JSON.stringify(tree.toJSON())).not.toContain('PRIVATE APP');
  await press(tree, safetyCopy.fr.accept); expect(JSON.stringify(tree.toJSON())).toContain('PRIVATE APP');
});
test('an acknowledged installation can review and hear the notice from Help without resetting it', async () => {
  await AsyncStorage.setItem(SAFETY_KEY, 'acknowledged');
  const tree = await render(wrap(<HelpScreen />));
  await press(tree, safetyCopy.fr.review);
  expect(JSON.stringify(tree.toJSON())).toContain(safetyCopy.fr.body);
  expect(Speech.speak).toHaveBeenCalledWith(safetyCopy.fr.body, expect.objectContaining({ language: 'fr-FR' }));
  await press(tree, safetyCopy.fr.accept);
  expect(await AsyncStorage.getItem(SAFETY_KEY)).toBe('acknowledged');
  expect(JSON.stringify(tree.toJSON())).toContain(safetyCopy.fr.review);
});
test('screen reader avoids double narration and missing French voice keeps text and acknowledgement usable', async () => {
  (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(true);
  const tree = await render(gate()); expect(Speech.speak).not.toHaveBeenCalled();
  (Speech.getAvailableVoicesAsync as jest.Mock).mockResolvedValue([]);
  await press(tree, safetyCopy.fr.listen); expect(JSON.stringify(tree.toJSON())).toContain(safetyCopy.fr.audioError);
  expect(JSON.stringify(tree.toJSON())).toContain(safetyCopy.fr.body); await press(tree, safetyCopy.fr.accept);
  expect(JSON.stringify(tree.toJSON())).toContain('PRIVATE APP');
});
test('changing language replaces narration, and leaving the foreground stops it', async () => {
  const callbacks: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => { callbacks.push(cb); return { remove: jest.fn() }; });
  const tree = await render(gate('en'));
  await act(async () => tree.update(gate('fr')));
  expect(Speech.speak).toHaveBeenLastCalledWith(safetyCopy.fr.body, expect.objectContaining({ language: 'fr-FR' }));
  (Speech.stop as jest.Mock).mockClear(); await act(async () => callbacks.at(-1)!('background')); expect(Speech.stop).toHaveBeenCalled();
});
test('French dictionaries cover every effective screen key, forms and help render in French', async () => {
  const keys = (v: object): string[] => Object.entries(v).flatMap(([k, x]) => x && typeof x === 'object' && !Array.isArray(x) ? keys(x).map(child => `${k}.${child}`) : [k]).sort();
  expect(keys(copies('fr'))).toEqual(keys(copies('en')));
  const tree = await render(wrap(<AuthScreen state={{ status: 'signed_out', session: null, error: '', notice: '' }} retry={() => {}} connection={() => {}} help={() => {}} />));
  await press(tree, copies('fr').m.signup); expect(tree.root.findAllByType(TextInput)).toHaveLength(4);
  await press(tree, copies('fr').a.signup); expect(JSON.stringify(tree.toJSON())).toContain(copies('fr').a.errors.invalid_email);
  const help = await render(wrap(<HelpScreen />)); expect(JSON.stringify(help.toJSON())).toContain(copies('fr').m.steps[1][1]);
});
