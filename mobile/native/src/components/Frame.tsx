import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Mark, Row, T, useUI } from './ui';
import type { Language } from '../shared/types';
export function Frame({ children, footer, languageChange, back }: { children: React.ReactNode; footer?: React.ReactNode; languageChange(language: Language): void; back?: () => void }) {
  const { colors, language } = useUI();
  const [footerHeight, setFooterHeight] = useState(112), [keyboardVisible, setKeyboardVisible] = useState(false);
  const showFooter = !!footer && !keyboardVisible;
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'right', 'bottom', 'left']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1 }}>
      <Row style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, justifyContent: 'space-between' }}>
        {back && <Button label={language === 'ar' ? 'رجوع' : 'Back'} icon={language === 'ar' ? 'arrow-right' : 'arrow-left'} onPress={back} />}
        <Row><Mark /><T variant="brand">Aether</T></Row><View style={{ flexDirection: 'row', gap: 4 }}><Button label="EN" selected={language === 'en'} onPress={() => languageChange('en')} /><Button label="ع" selected={language === 'ar'} onPress={() => languageChange('ar')} /></View>
      </Row>
      <View style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: showFooter ? footerHeight + 24 : 36, gap: 24 }} scrollIndicatorInsets={{ bottom: showFooter ? footerHeight : 0 }} automaticallyAdjustKeyboardInsets={false}>{children}</ScrollView>
        {showFooter && <View testID="floating-navigation" pointerEvents="box-none" onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>{footer}</View>}
      </View>
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}
