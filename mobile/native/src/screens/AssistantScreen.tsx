import React, { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, Card, Cassette, Field, Mark, Notice, Reveal, Row, Sheet, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
import { historyStreamCopy } from '../i18n/historyStreamCopy';
import { GoCameraPreview, RtcPreview, type GoCamera } from '../platform/camera';
import type { SessionController, SessionState } from '../session/controller';
import type { Language } from '../shared/types';
import { assistantLayout } from './assistantLayout';

export function AssistantScreen({ media, controller, camera, caps, prompt, start, back, changeLanguage, backRef }: {
  media: SessionState; controller: SessionController; camera: GoCamera;
  caps: { go: boolean; webrtc: boolean; recognition: boolean }; prompt: number | null;
  start(): void; back(): void; changeLanguage(language: Language): void;
  backRef?: React.Ref<React.ComponentRef<typeof View>>;
}) {
  const { language, colors } = useUI(), { m, n } = copies(language), h = historyStreamCopy[language];
  const dimensions = useWindowDimensions(), insets = useSafeAreaInsets();
  const [height, setHeight] = useState(dimensions.height), [details, setDetails] = useState(false), [typed, setTyped] = useState('');
  const detailsRef = useRef<React.ComponentRef<typeof View>>(null);
  const restoreFocus = useCallback(() => { const id = findNodeHandle(detailsRef.current); if (id) AccessibilityInfo.setAccessibilityFocus(id); }, []);
  const layout = assistantLayout(height, insets.bottom, dimensions.fontScale);
  const phase = media.phase === 'greeting' ? n.openingGreeting : media.phase === 'unavailable' ? n.unavailable : media.phase === 'error' ? n.error : media.phase === 'starting' ? m.starting : media.phase === 'idle' ? m.ready : m[media.phase];
  const errors = [...new Set([media.cameraError, media.voiceError === 'silence' ? '' : media.voiceError, media.error,
    media.transport === 'failed' ? 'transportFailed' : '', media.registry === 'failed' ? 'registry_failed' : ''].filter(Boolean))];
  const errorText = (code: string) => n[code as keyof typeof n] as string || n.error;
  const excerpt = media.answer?.answer || media.transcript || (prompt !== null ? `${m.questions[prompt]} ${m.say}` : '');
  const answerLabel = n.serverAnswer;
  return <View testID="assistant-screen" style={{ flex: 1, backgroundColor: colors.bg }} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    <StatusBar style="light" />
    <View testID="camera-viewport" style={{ height: layout.camera, overflow: 'hidden', backgroundColor: '#141414' }}>
      {caps.go && <GoCameraPreview camera={camera} />}
      {caps.webrtc && media.cameraUrl && <RtcPreview url={media.cameraUrl} />}
      <View pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: '#141414' }} />
      {!media.active && <Pressable accessibilityRole="button" accessibilityLabel={m.startLabel} onPress={start} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}><Mark size={110} /><T style={{ color: 'white' }}>{m.tap}</T></Pressable>}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: insets.left + 12, right: insets.right + 12, gap: 10 }}>
        <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Button focusRef={backRef} label={m.back} icon={language === 'ar' ? 'arrow-right' : 'arrow-left'} onPress={back} />
          <View style={{ flex: 1, backgroundColor: '#141414E8', borderRadius: 10, padding: 12 }}>
            <T accessibilityLiveRegion={['speaking', 'greeting', 'hearing'].includes(media.phase) ? 'none' : 'polite'} style={{ color: 'white' }}>{phase}</T>
            {media.active && !media.camera && <T variant="small" style={{ color: '#D0D0D0' }}>{media.cameraError ? m.voiceOnly : m.preparing}</T>}
            {media.transport === 'reconnecting' && <T accessibilityLiveRegion="polite" variant="small" style={{ color: '#D0D0D0' }}>{h.reconnecting}</T>}
          </View>
        </Row>
        {media.active && media.phase === 'paused' && <Button label={m.resume} onPress={() => controller.resume()} />}
        {!!errors.length && <Pressable accessibilityRole="button" accessibilityLabel={errorText(errors[0])} accessibilityHint={n.details} onPress={() => setDetails(true)} style={{ padding: 12, backgroundColor: colors.dangerBg, borderRadius: 10 }}><T numberOfLines={2} style={{ color: colors.danger }}>{errorText(errors[0])}</T></Pressable>}
        {media.active && media.camera && (media.transport === 'failed' || media.registry === 'failed') && <Button label={h.retryStream} onPress={() => controller.retryStream()} />}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={excerpt ? `${answerLabel}. ${excerpt}` : answerLabel} accessibilityHint={n.details} onPress={() => setDetails(true)} style={{ position: 'absolute', bottom: 12, left: insets.left + 12, right: insets.right + 12, borderRadius: 10, padding: 12, gap: 4, backgroundColor: '#141414E8' }}>
        <T variant="small" style={{ color: '#D0D0D0' }}>{answerLabel}{media.answer?.uncertain ? ` · ${n.uncertain}` : ''}</T>
        {!!excerpt && <T numberOfLines={dimensions.fontScale > 1.5 ? 1 : 2} language={media.answer?.language ?? language} style={{ color: 'white' }}>{excerpt}</T>}
      </Pressable>
    </View>
    <ScrollView testID="session-controls" style={{ height: layout.controls, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }}>
      <Row style={{ flexWrap: 'nowrap', alignItems: 'stretch' }}>
        <View style={{ flex: 1 }}><Button focusRef={detailsRef} label={media.answer ? m.answer : n.details} onPress={() => setDetails(true)} /></View>
        <View style={{ flex: 1 }}><Button testID="session-toggle" danger={media.active} primary={!media.active} label={media.active ? m.stop : m.start} icon={media.active ? undefined : 'mic'} onPress={() => media.active ? controller.stop() : start()} /></View>
      </Row>
    </ScrollView>
    {details && <Sheet title={m.assistant} onClose={() => setDetails(false)} restoreFocus={restoreFocus}>
      <Row><Button label="EN" selected={language === 'en'} onPress={() => changeLanguage('en')} /><Button label="ع" selected={language === 'ar'} onPress={() => changeLanguage('ar')} /><Button label="FR" selected={language === 'fr'} onPress={() => changeLanguage('fr')} /></Row>
      {media.answer?.uncertain && <Notice>{n.uncertain}</Notice>}
      {!!media.answer?.evidenceFrameIds?.length && <T variant="small">{n.evidence}: {media.answer.evidenceFrameIds.length}</T>}
      {prompt !== null && <Card><T>{m.questions[prompt]}</T><T variant="small">{m.say}</T></Card>}
      {!!media.transcript && <Card><T variant="label">{m.transcript}</T><T>{media.transcript}</T></Card>}
      {media.answer && <Reveal key={media.answer.id}><Card><T variant="heading">{m.answer}</T><T language={media.answer.language}>{media.answer.answer}</T><Cassette onReplay={() => { void controller.replay(media.answer!); }} /></Card></Reveal>}
      {media.phase === 'speaking' && <Button label={n.stopSpeech} onPress={() => controller.stopPlayback()} />}
      {(!caps.recognition || !caps.webrtc) && <Notice>{n.native_required}</Notice>}
      {caps.go && __DEV__ && media.active && <Card><Field label={n.typedLabel} value={typed} onChangeText={setTyped} /><Button label={n.typedQuestionAction} disabled={!typed.trim() || ['greeting', 'speaking', 'processing', 'paused'].includes(media.phase)} onPress={() => { void controller.typedQuestion(typed); setTyped(''); }} /></Card>}
      {errors.map(code => <Notice key={code} danger>{errorText(code)}</Notice>)}
    </Sheet>}
  </View>;
}
