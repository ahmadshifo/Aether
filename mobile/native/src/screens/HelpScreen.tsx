import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Notice, Row, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
import { FirstUseGate } from '../components/FirstUseGate';
import { safetyCopy } from '../i18n/safetyCopy';
import type { Language } from '../shared/types';
export function HelpScreen({ changeLanguage = () => {} }: { changeLanguage?(language: Language): void }) {
  const [review, setReview] = useState(false);
  const { language, colors } = useUI(), { m, n } = copies(language);
  if (review) return <FirstUseGate review onDone={() => setReview(false)} changeLanguage={changeLanguage}>{null}</FirstUseGate>;
  return <View style={{ gap: 24 }}><T variant="title" accessibilityRole="header">{m.how}</T>
    {m.steps.map(([title, text], index) => <Card key={title}><Row><T variant="label">{String(index + 1).padStart(2, '0')}</T><T variant="heading" style={{ flex: 1 }}>{title}</T></Row><T>{text}</T></Card>)}
    <T variant="heading">{m.tryAsking}</T>{[m.questions[1], m.questions[0], m.questions[3]].map((q, i) => <Card key={q} style={{ borderStyle: 'dashed', borderWidth: 2, borderColor: colors.line, transform: [{ rotate: i % 2 ? '1.5deg' : '-1.5deg' }] }}><T>{q}</T></Card>)}
    <Notice>{m.safety}</Notice><Button label={safetyCopy[language].review} onPress={() => setReview(true)} /><T>{n.osSpeech}</T>
    <Button label={n.permissionSettings} onPress={() => { void Linking.openSettings().catch(() => {}); }} />
  </View>;
}
