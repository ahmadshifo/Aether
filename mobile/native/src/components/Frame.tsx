import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Mark, Row, T, useUI } from './ui';
import type { Language } from '../shared/types';
export function Frame({ children, footer, languageChange, back }: { children: React.ReactNode; footer?: React.ReactNode; languageChange(language: Language): void; back?: () => void }) {
  const { colors, language } = useUI();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'right', 'bottom', 'left']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1 }}>
      <Row style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, justifyContent: 'space-between' }}>
        {back && <Button label={language === 'ar' ? 'رجوع' : 'Back'} icon={language === 'ar' ? 'arrow-right' : 'arrow-left'} onPress={back} />}
        <Row><Mark /><T variant="brand">Aether</T></Row><View style={{ flexDirection: 'row', gap: 4 }}><Button label="EN" selected={language === 'en'} onPress={() => languageChange('en')} /><Button label="ع" selected={language === 'ar'} onPress={() => languageChange('ar')} /></View>
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 24 }} automaticallyAdjustKeyboardInsets={false}>{children}</ScrollView>
      {footer}
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}
