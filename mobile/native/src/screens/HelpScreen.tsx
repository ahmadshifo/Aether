import React from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Notice, Row, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
export function HelpScreen() {
  const { language, colors } = useUI(), { m, n } = copies(language);
  return <View style={{ gap: 24 }}><T variant="title" accessibilityRole="header">{m.how}</T><T>{m.helpIntro}</T>
    {m.steps.map(([title, text], index) => <Card key={title}><Row><T variant="label">{String(index + 1).padStart(2, '0')}</T><T variant="heading" style={{ flex: 1 }}>{title}</T></Row><T>{text}</T></Card>)}
    <T variant="heading">{m.tryAsking}</T>{[m.questions[1], 'ماذا يوجد أمامي؟', m.questions[3]].map((q, i) => <Card key={q} style={{ borderStyle: 'dashed', borderWidth: 2, borderColor: colors.line, transform: [{ rotate: i % 2 ? '1.5deg' : '-1.5deg' }] }}><T language={i === 1 ? 'ar' : language}>{q}</T></Card>)}
    <Notice>{m.safety}</Notice><Notice>{n.demoExplanation}</Notice><T>{n.osSpeech}</T>
    <Button label={n.permissionSettings} onPress={() => { void Linking.openSettings().catch(() => {}); }} />
  </View>;
}
