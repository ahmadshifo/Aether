import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { copies } from '../i18n/nativeCopy';
import { loadGlassView } from '../platform/glass';
import type { Page } from '../shared/types';
import { dark } from '../theme/tokens';
import Icon from './Icon';
import { Mark, T, useUI } from './ui';

const destinations = ['home', 'history', 'assistant', 'help', 'settings'] as const;
type Destination = typeof destinations[number];

export function GlassBottomBar({ page, onNavigate, onStart }: {
  page: Page; onNavigate(page: Destination): void; onStart(): void;
}) {
  const { colors, language, motion } = useUI(), { m } = copies(language);
  const night = colors.bg === dark.bg, rtl = language === 'ar';
  const [Glass] = useState(() => loadGlassView());
  const [reduceTransparency, setReduceTransparency] = useState(true);
  const [width, setWidth] = useState(0);
  const slide = useRef(new Animated.Value(0)).current, positioned = useRef(false);
  const sheenId = useId().replace(/:/g, '');
  // Connection is a settings destination; Assistant has its own full-screen controls.
  const selected = destinations.indexOf(page === 'connection' ? 'settings' : page as Destination);
  const slot = width / destinations.length;

  useEffect(() => {
    let alive = true, changed = false;
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => {
      changed = true; setReduceTransparency(value);
    });
    void Promise.resolve(AccessibilityInfo.isReduceTransparencyEnabled()).then(value => {
      if (alive && !changed) setReduceTransparency(value === true);
    }).catch(() => {});
    return () => { alive = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (!width || selected < 0) return;
    const toValue = (rtl ? destinations.length - 1 - selected : selected) * slot;
    if (!motion || !positioned.current) slide.setValue(toValue);
    else Animated.spring(slide, { toValue, damping: 24, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
    positioned.current = true;
    return () => slide.stopAnimation();
  }, [motion, rtl, selected, slide, slot, width]);

  const nativeGlass = Glass && !reduceTransparency;
  return <View testID="glass-bottom-bar" style={styles.dock}>
    <View style={[styles.surface, { shadowOpacity: night ? 0.3 : 0.12 }]}>
      {nativeGlass ? <Glass pointerEvents="none" accessible={false} testID="native-glass-surface" glassEffectStyle="regular" colorScheme={night ? 'dark' : 'light'} style={styles.backdrop} />
        : <View pointerEvents="none" testID="glass-fallback" style={[styles.backdrop, { backgroundColor: colors.card }]} />}
      {!reduceTransparency && <View pointerEvents="none" accessible={false} style={styles.sheen}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs><LinearGradient id={sheenId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={night ? 0.16 : 0.85} />
            <Stop offset="0.48" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="1" stopColor={night ? '#FFFFFF' : '#B8C1CC'} stopOpacity={night ? 0.04 : 0.16} />
          </LinearGradient></Defs>
          <Rect width="100%" height="100%" fill={`url(#${sheenId})`} />
        </Svg>
      </View>}
      <View pointerEvents="none" style={[styles.rim, { borderColor: night ? '#FFFFFF29' : '#FFFFFFD9' }]} />
      <View testID="glass-tabs" accessibilityRole="tablist" accessibilityLabel={m.navigation} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'stretch' }}>
        {width > 0 && selected >= 0 && <Animated.View pointerEvents="none" testID="glass-tab-indicator" style={[styles.indicator, {
          width: slot, backgroundColor: night ? '#FFFFFF1F' : '#2020200D', borderColor: night ? '#FFFFFF26' : '#FFFFFFD9',
          transform: [{ translateX: slide }],
        }]} />}
        {destinations.map((destination, index) => <Pressable key={destination} testID={`tab-${destination}`} accessibilityRole="tab"
          accessibilityLabel={destination === 'assistant' ? `${m.assistant}: ${m.startLabel}` : m[destination]}
          accessibilityState={{ selected: selected === index }}
          onPress={() => destination === 'assistant' ? onStart() : onNavigate(destination)}
          style={({ pressed }) => [styles.tab, { backgroundColor: pressed ? night ? '#FFFFFF1A' : '#2020200A' : 'transparent' }]}>
          <View accessible={false} style={styles.icon}>
            {destination === 'assistant' ? <View style={{ borderRadius: 16, overflow: 'hidden' }}><Mark size={32} /></View>
              : <Icon name={destination === 'help' ? 'circle-help' : destination} size={22} color={colors.ink} strokeWidth={selected === index ? 2.3 : 1.7} />}
          </View>
          <T style={{ fontSize: 11, lineHeight: language === 'ar' ? 20 : 16, textAlign: 'center', fontWeight: selected === index ? '700' : '500', color: colors.ink, alignSelf: 'stretch' }}>{m[destination]}</T>
        </Pressable>)}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  dock: { marginHorizontal: 12, marginTop: 12, marginBottom: 12 },
  surface: { padding: 6, borderRadius: 40, shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 8 },
  backdrop: { ...StyleSheet.absoluteFill, borderRadius: 40 },
  sheen: { ...StyleSheet.absoluteFill, borderRadius: 40, overflow: 'hidden' },
  rim: { ...StyleSheet.absoluteFill, borderRadius: 40, borderWidth: 1 },
  indicator: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 32, borderWidth: 1 },
  tab: { flex: 1, minWidth: 0, minHeight: 64, paddingVertical: 6, paddingHorizontal: 2, borderRadius: 32, alignItems: 'center', justifyContent: 'flex-start', gap: 3 },
  icon: { height: 32, alignItems: 'center', justifyContent: 'center' },
});
