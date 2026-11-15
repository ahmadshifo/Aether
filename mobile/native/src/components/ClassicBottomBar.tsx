// The bottom navigation used on Android (Samsung): the original Aether bar from before the iPhone glass bar.
// A flat card under the page (not floating over it), with the Aether mark raised in the middle to start the
// Assistant. iPhone keeps GlassBottomBar, which uses Apple's Liquid Glass.
import React from 'react';
import { Pressable, View } from 'react-native';
import { copies } from '../i18n/nativeCopy';
import type { Page } from '../shared/types';
import Icon from './Icon';
import { Mark, T, useUI } from './ui';

const destinations = ['home', 'history', 'assistant', 'help', 'settings'] as const;
type Destination = typeof destinations[number];

export function ClassicBottomBar({ page, onNavigate, onStart }: {
  page: Page; onNavigate(page: Destination): void; onStart(): void;
}) {
  const { colors, language } = useUI(), { m } = copies(language);
  // Connection is a settings destination; Assistant has its own full-screen controls.
  const current = page === 'connection' ? 'settings' : page;
  return <View testID="classic-bottom-bar" accessibilityRole="tablist" accessibilityLabel={m.navigation} style={{
    margin: 12, marginTop: 26, padding: 6, flexWrap: 'nowrap', alignItems: 'center', borderWidth: 1, borderColor: colors.lineCard,
    borderRadius: 16, backgroundColor: colors.card, gap: 2, flexDirection: language === 'ar' ? 'row-reverse' : 'row',
  }}>
    {destinations.map(destination => <Pressable key={destination} testID={`tab-${destination}`} accessibilityRole="tab"
      accessibilityLabel={destination === 'assistant' ? `${m.assistant}: ${m.startLabel}` : m[destination]}
      accessibilityState={{ selected: current === destination }}
      onPress={() => destination === 'assistant' ? onStart() : onNavigate(destination)}
      style={{ flex: 1, minHeight: 60, paddingVertical: 8, paddingHorizontal: 2, alignItems: 'center', gap: 6,
        backgroundColor: current === destination ? colors.inset : undefined, borderRadius: 10 }}>
      {destination === 'assistant'
        ? <View style={{ marginTop: -26, borderWidth: 4, borderColor: colors.card, borderRadius: 14, overflow: 'hidden' }}><Mark size={48} /></View>
        : <Icon name={destination === 'help' ? 'circle-help' : destination} color={colors.ink} />}
      <T style={{ fontSize: 11, textAlign: 'center', fontWeight: current === destination ? '700' : '400' }}>{m[destination]}</T>
    </Pressable>)}
  </View>;
}
