import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Keyboard, Platform, ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { requireOptionalNativeModule } from 'expo';
import { GlassBottomBar } from '../src/components/GlassBottomBar';
import { Frame } from '../src/components/Frame';
import { UIContext } from '../src/components/ui';
import { loadGlassView } from '../src/platform/glass';
import { monoCopy } from '../src/i18n/monoCopy';
import { dark, light } from '../src/theme/tokens';

let mockGlassEvaluations = 0;
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));
jest.mock('expo-glass-effect', () => {
  mockGlassEvaluations++;
  return { GlassView: require('react-native').View, isGlassEffectAPIAvailable: jest.fn(() => true), isLiquidGlassAvailable: jest.fn(() => true) };
});
const optionalModule = requireOptionalNativeModule as jest.Mock;
const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
const metrics = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 59, bottom: 34, left: 0, right: 0 } };
const wrap = (children: React.ReactNode, language: 'en' | 'ar' = 'en') => <SafeAreaProvider initialMetrics={metrics}><UIContext.Provider value={{ language, colors: language === 'ar' ? dark : light, fonts: false, motion: false, haptics: false }}>{children}</UIContext.Provider></SafeAreaProvider>;
async function render(element: React.ReactNode) { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(element); }); return tree; }
const tabsIn = (tree: renderer.ReactTestRenderer) => tree.root.findAll(node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function');

beforeEach(() => {
  optionalModule.mockReturnValue(null);
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
});
afterEach(() => { Object.defineProperty(Platform, 'OS', os); jest.restoreAllMocks(); jest.clearAllMocks(); });

test('the existing iPhone binary never evaluates the absent glass module', () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  expect(loadGlassView()).toBeNull();
  expect(mockGlassEvaluations).toBe(0);
});

test('Android and iOS without the runtime glass API use the fallback', () => {
  optionalModule.mockReturnValue({});
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  expect(loadGlassView()).toBeNull();
  expect(optionalModule).not.toHaveBeenCalled();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const glass = require('expo-glass-effect');
  glass.isGlassEffectAPIAvailable.mockReturnValueOnce(false);
  expect(loadGlassView()).toBeNull();
  glass.isLiquidGlassAvailable.mockReturnValueOnce(false);
  expect(loadGlassView()).toBeNull();
  expect(loadGlassView()).toBe(View);
});

test('Reduce Transparency switches native glass to an opaque bar without removing its controls', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  optionalModule.mockReturnValue({});
  const events = new Map<string, (enabled: boolean) => void>();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
    events.set(event, listener); return { remove: () => events.delete(event) };
  });
  const tree = await render(wrap(<GlassBottomBar page="home" onNavigate={() => {}} onStart={() => {}} />));
  expect(tree.root.findAllByProps({ testID: 'native-glass-surface' }).length).toBeGreaterThan(0);
  await act(async () => events.get('reduceTransparencyChanged')!(true));
  expect(tree.root.findAllByProps({ testID: 'native-glass-surface' })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: 'glass-fallback' }).length).toBeGreaterThan(0);
  expect(tabsIn(tree)).toHaveLength(5);
  await act(async () => tree.unmount());
  expect(events.size).toBe(0);
});

test.each(['en', 'ar'] as const)('all translated tabs navigate and the centre action still starts a session: %s', async language => {
  const navigate = jest.fn(), start = jest.fn();
  const tree = await render(wrap(<GlassBottomBar page="connection" onNavigate={navigate} onStart={start} />, language));
  const tabs = tabsIn(tree);
  expect(tabs).toHaveLength(5);
  expect(tabs.find(tab => tab.props.accessibilityState.selected)?.props.accessibilityLabel).toBe(monoCopy[language].settings);
  for (const tab of tabs) await act(async () => tab.props.onPress());
  expect(navigate.mock.calls.map(([page]) => page)).toEqual(['home', 'history', 'help', 'settings']);
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test('floating navigation reserves its measured height and hides while a form keyboard is open', async () => {
  const events = new Map<string, () => void>();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    events.set(event, listener as () => void); return { remove: () => events.delete(event) };
  });
  const tree = await render(wrap(<Frame languageChange={() => {}} footer={<GlassBottomBar page="settings" onNavigate={() => {}} onStart={() => {}} />}><View /></Frame>));
  const dock = tree.root.findAllByType(View).find(view => view.props.testID === 'floating-navigation')!;
  await act(async () => dock.props.onLayout({ nativeEvent: { layout: { height: 150 } } }));
  const content = tree.root.findByType(ScrollView);
  expect(content.props.contentContainerStyle.paddingBottom).toBeGreaterThan(150);
  await act(async () => events.get(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow')!());
  expect(tree.root.findAllByType(GlassBottomBar)).toHaveLength(0);
  await act(async () => events.get(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide')!());
  expect(tree.root.findAllByType(GlassBottomBar)).toHaveLength(1);
  await act(async () => tree.unmount());
});
