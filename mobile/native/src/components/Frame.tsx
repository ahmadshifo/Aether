import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Mark, Row, T, useUI } from './ui';
import type { Language } from '../shared/types';
import { copies } from '../i18n/nativeCopy';
// floatingFooter: the footer floats over the scrolling page (iPhone glass bar); otherwise it sits under it.
export function Frame({ children, footer, languageChange, back, floatingFooter = true }: { children: React.ReactNode; footer?: React.ReactNode; languageChange(language: Language): void; back?: () => void; floatingFooter?: boolean }) {
  const { colors, language } = useUI();
  const [footerHeight, setFooterHeight] = useState(112), [keyboardVisible, setKeyboardVisible] = useState(false);
  const showFooter = !!footer && !keyboardVisible, floating = showFooter && floatingFooter;
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'right', 'bottom', 'left']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1 }}>
      <Row style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, justifyContent: 'space-between' }}>
        {back && <Button label={copies(language).m.back} icon={language === 'ar' ? 'arrow-right' : 'arrow-left'} onPress={back} />}
        <Row><Mark /><T variant="brand">Aether</T></Row><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}><Button label="EN" selected={language === 'en'} onPress={() => languageChange('en')} /><Button label="ع" selected={language === 'ar'} onPress={() => languageChange('ar')} /><Button label="FR" selected={language === 'fr'} onPress={() => languageChange('fr')} /></View>
      </Row>
      <View style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: floating ? footerHeight + 24 : 36, gap: 24 }} scrollIndicatorInsets={{ bottom: floating ? footerHeight : 0 }} automaticallyAdjustKeyboardInsets={false}>{children}</ScrollView>
        {floating && <View testID="floating-navigation" pointerEvents="box-none" onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>{footer}</View>}
      </View>
      {showFooter && !floatingFooter && footer}
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}
