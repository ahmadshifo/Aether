import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, findNodeHandle, Modal as NativeModal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextProps, type TextInputProps, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Language } from '../shared/types';
import { light, geometry } from '../theme/tokens';
import { copies } from '../i18n/nativeCopy';
import Icon from './Icon';
export const UIContext = createContext({ language: 'en' as Language, colors: light, fonts: false, motion: true, haptics: false });
export const useUI = () => useContext(UIContext);
export function T({ variant = 'body', language, style, ...props }: TextProps & { variant?: 'body' | 'title' | 'heading' | 'small' | 'label' | 'brand'; language?: Language }) {
  const ui = useUI(), lang = language ?? ui.language;
  const sizes = { body: 16, title: 30, heading: 18, small: 14, label: 11, brand: 34 };
  const font = variant === 'brand' ? 'PirataOne' : lang === 'ar' ? 'NotoSansArabic' : variant === 'label' ? 'JetBrainsMono' : ['heading', 'title'].includes(variant) ? 'InterSemi' : 'Inter';
  return <Text {...props} allowFontScaling style={[{ color: ui.colors.ink, fontSize: sizes[variant], lineHeight: sizes[variant] * (lang === 'ar' ? 1.8 : 1.5), textAlign: lang === 'ar' && variant !== 'brand' ? 'right' : 'left', writingDirection: lang === 'ar' && variant !== 'brand' ? 'rtl' : 'ltr', ...(ui.fonts ? { fontFamily: font } : {}), ...(['small', 'label'].includes(variant) ? { color: ui.colors.muted } : {}) }, style]} />;
}
export function Mark({ size = 34 }: { size?: number }) {
  const { colors } = useUI();
  return <View accessible={false} style={{ width: size, height: size, backgroundColor: colors.ink }}>
    {[0.28, 0.59].map(left => <View key={left} style={{ position: 'absolute', left: size * left, top: size * 0.365, width: size * 0.13, height: size * 0.27, borderRadius: size * 0.065, backgroundColor: colors.bg }} />)}
  </View>;
}
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { language } = useUI();
  return <View style={[{ flexDirection: language === 'ar' ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, style]}>{children}</View>;
}
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useUI(); return <View style={[{ padding: 20, borderWidth: 1, borderColor: colors.lineCard, borderRadius: geometry.card, backgroundColor: colors.card, gap: 12 }, style]}>{children}</View>;
}
export function Button({ label, onPress, disabled, primary, danger, large, icon, selected, hint, testID }: { label: string; onPress(): void; disabled?: boolean; primary?: boolean; danger?: boolean; large?: boolean; icon?: React.ComponentProps<typeof Icon>['name']; selected?: boolean; hint?: string; testID?: string }) {
  const { colors, haptics, language } = useUI();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled, selected: !!selected }} disabled={disabled}
    onPress={() => { if (haptics) void Haptics.selectionAsync().catch(() => {}); onPress(); }}
    style={({ pressed }) => ({ minHeight: large ? 92 : primary ? 64 : 48, minWidth: 48, padding: primary ? 16 : 12, borderRadius: primary ? 13 : 10, borderWidth: 1, borderBottomWidth: primary && !pressed ? 7 : 1, borderColor: danger ? colors.danger : primary ? colors.edge : selected ? colors.ink : colors.line, backgroundColor: danger ? colors.dangerBg : primary ? colors.tactile : selected ? colors.inset : colors.card, opacity: disabled ? 0.55 : pressed ? 0.8 : 1, transform: [{ translateY: primary && pressed ? 4 : 0 }], alignItems: 'center', justifyContent: 'center', flexDirection: language === 'ar' ? 'row-reverse' : 'row', gap: 10 })}>
    {icon && <Icon name={icon} color={primary ? colors.onTactile : danger ? colors.danger : colors.ink} />}
    <T style={{ color: primary ? colors.onTactile : danger ? colors.danger : colors.ink, textAlign: 'center', flexShrink: 1 }}>{label}</T>
  </Pressable>;
}
export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors, language, fonts } = useUI();
  return <View style={{ gap: 8 }}><T>{label}</T><TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.muted}
    style={[{ minHeight: 54, borderRadius: 10, borderWidth: 1, borderColor: colors.muted, backgroundColor: colors.card, color: colors.ink, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: fonts ? language === 'ar' ? 'NotoSansArabic' : 'Inter' : undefined, textAlign: language === 'ar' ? 'right' : 'left' }, style]} /></View>;
}
export function Notice({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  const { colors } = useUI();
  return <View accessibilityRole={danger ? 'alert' : undefined} style={{ backgroundColor: danger ? colors.dangerBg : colors.warnBg, borderRadius: 12, padding: 16 }}><T variant="small" style={{ color: danger ? colors.danger : colors.warn }}>{children}</T></View>;
}
export function Sheet({ title, onClose, children, restoreFocus }: { title: string; onClose(): void; children: React.ReactNode; restoreFocus?(): void }) {
  const { colors, language } = useUI(), t = copies(language).m;
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);
  useEffect(() => () => restoreFocus?.(), [restoreFocus]);
  return <NativeModal transparent animationType="none" visible onRequestClose={onClose} onShow={() => { const id = findNodeHandle(titleRef.current); if (id) AccessibilityInfo.setAccessibilityFocus(id); }}>
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 40 }}>
      <View style={{ maxHeight: '100%', width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }}>
        <Row style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}><Text ref={titleRef} accessibilityRole="header" style={{ color: colors.ink, fontSize: 24, flex: 1, textAlign: language === 'ar' ? 'right' : 'left' }}>{title}</Text><Button label={t.close} onPress={onClose} /></Row>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>{children}</ScrollView>
      </View>
    </View>
  </NativeModal>;
}
export function HoldButton({ clear, onConfirm, onOptions, disabled }: { clear?: boolean; onConfirm(): void; onOptions(): void; disabled?: boolean }) {
  const { language, colors } = useUI(), t = copies(language).m;
  const hold = useRef<{ at: number; inside: boolean } | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bounds = useRef({ width: 0, height: 0 });
  const [stage, setStage] = useState<'idle' | 'holding' | 'armed'>('idle');
  const cancel = () => { hold.current = null; clearTimeout(timer.current); setStage('idle'); };
  useEffect(() => { const sub = AppState.addEventListener('change', cancel); return () => { sub.remove(); clearTimeout(timer.current); }; }, []);
  const label = stage === 'armed' ? clear ? t.releaseClear : t.releaseStop : stage === 'holding' ? t.holding : clear ? t.holdClear : t.holdStop;
  return <View style={{ gap: 8 }}><View accessibilityRole="button" accessibilityLabel={clear ? t.holdClear : t.holdStop} accessibilityState={{ disabled: !!disabled }} accessible
    accessibilityActions={[{ name: 'activate', label: clear ? t.clearOptions : t.stopOptions }]} onAccessibilityAction={e => { if (!disabled && e.nativeEvent.actionName === 'activate') onOptions(); }}
    onLayout={event => { bounds.current = event.nativeEvent.layout; }} onStartShouldSetResponder={() => !disabled}
    onResponderGrant={() => { hold.current = { at: Date.now(), inside: true }; setStage('holding'); timer.current = setTimeout(() => { if (hold.current?.inside) setStage('armed'); }, 1000); }}
    onResponderMove={e => { const { locationX, locationY } = e.nativeEvent; if (locationX < 0 || locationY < 0 || locationX > bounds.current.width || locationY > bounds.current.height) cancel(); }}
    onResponderTerminationRequest={() => true} onResponderTerminate={cancel}
    onResponderRelease={e => { const value = hold.current, { locationX, locationY } = e.nativeEvent; cancel(); if (value?.inside && locationX >= 0 && locationY >= 0 && locationX <= bounds.current.width && locationY <= bounds.current.height) { if (Date.now() - value.at >= 1000) onConfirm(); else if (Date.now() - value.at < 250) onOptions(); } }}
    style={{ minHeight: clear ? 64 : 92, padding: 20, borderRadius: 14, backgroundColor: clear ? colors.dangerBg : colors.tactile, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      <T style={{ color: clear ? colors.danger : colors.onTactile, textAlign: 'center', fontSize: 20 }}>{label}</T>
    </View><Button label={clear ? t.clearOptions : t.stopOptions} onPress={onOptions} disabled={disabled} /></View>;
}
export function Reveal({ children }: { children: React.ReactNode }) {
  const { motion } = useUI(), value = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => { Animated.timing(value, { toValue: 1, duration: motion ? 900 : 0, useNativeDriver: true }).start(); return () => value.stopAnimation(); }, [motion, value]);
  return <Animated.View style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}>{children}</Animated.View>;
}
export function Cassette({ onReplay, disabled }: { onReplay(): void; disabled?: boolean }) {
  const { language, colors } = useUI(), { m } = copies(language);
  return <View style={{ gap: 10 }}><Row style={{ backgroundColor: colors.cassette, borderRadius: 14, padding: 16 }}><Button label={m.replay} onPress={onReplay} disabled={disabled} icon="volume" />
    <View accessible={false} style={{ flex: 1, minWidth: 60, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#696861', borderRadius: 20, padding: 5 }}>
      {[0, 1].map(i => <React.Fragment key={i}>{i === 1 && <View style={{ height: 4, flex: 1, backgroundColor: colors.track }} />}<View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.reel, borderWidth: 5, borderColor: colors.cassette }} /></React.Fragment>)}
    </View></Row><T variant="small">{m.audioLimits}</T></View>;
}
export const styles = StyleSheet.create({ stack: { gap: 24 }, flex: { flex: 1 }, center: { alignItems: 'center', gap: 20 }, footer: { padding: 16, gap: 10 }, keyboard: { flex: 1, ...(Platform.OS === 'ios' ? {} : {}) } });
