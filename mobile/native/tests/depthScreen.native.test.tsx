import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Sheet, UIContext } from '../src/components/ui';
import { depthCopy } from '../src/i18n/depthCopy';
import { copies } from '../src/i18n/nativeCopy';
import { GoCamera } from '../src/platform/camera';
import { AssistantScreen } from '../src/screens/AssistantScreen';
import { SessionController, type SessionPorts, type SessionState } from '../src/session/controller';
import { light } from '../src/theme/tokens';

test.each(['en', 'ar', 'fr'] as const)('camera warning, local answer, and depth state in Details: %s', async language => {
  const d = depthCopy[language], controller = new SessionController({} as SessionPorts);
  const camera = new GoCamera(), distance = d.measured(1.4);
  const state: SessionState = { ...controller.getSnapshot(), active: true, camera: true, phase: 'listening',
    depthState: 'near', depthMessage: distance };
  const screen = (media: SessionState) => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 30, bottom: 20, left: 0, right: 0 } }}>
    <UIContext.Provider value={{ language, colors: light, fonts: false, motion: false, haptics: false }}>
      <AssistantScreen media={media} camera={camera} controller={controller} caps={{ go: false, webrtc: true, recognition: true }}
        prompt={null} start={() => {}} back={() => {}} changeLanguage={() => {}} />
    </UIContext.Provider>
  </SafeAreaProvider>;
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(screen(state)); });
    expect(JSON.stringify(tree.toJSON())).toContain(d.near);
    expect(JSON.stringify(tree.toJSON())).toContain(distance);
    const answerButton = tree.root.findAllByType(Button).find(b => b.props.label === copies(language).m.answer)!;
    await act(async () => answerButton.props.onPress());
    expect(tree.root.findByType(Sheet).findAll(node => node.props.children === distance).length).toBeGreaterThan(0);
    await act(async () => tree.update(screen({ ...state, depthState: 'waiting', depthMessage: undefined })));
    expect(JSON.stringify(tree.toJSON())).toContain(d.aim);
    expect(JSON.stringify(tree.toJSON())).not.toContain(d.near);
    await act(async () => tree.update(screen({ ...state, depthState: 'unavailable', depthMessage: undefined })));
    expect(JSON.stringify(tree.toJSON())).toContain(d.unavailable);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
