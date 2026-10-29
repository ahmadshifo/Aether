import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EchoIcon } from '../components/EchoIcon';
import { styles as s } from '../components/theme';
import { words } from '../i18n/words';
import type { HistoryItem, Language } from '../types';
export function HistorySheet({ language, items, onClose, onReplay }: {
  language: Language; items: HistoryItem[]; onClose: () => void; onReplay: (item: HistoryItem) => void;
}) {
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const t = words[language]; const insets = useSafeAreaInsets();
  const direction = { writingDirection: language === 'ar' ? 'rtl' as const : 'ltr' as const, textAlign: language === 'ar' ? 'right' as const : 'left' as const };
  const sample: HistoryItem = { id: `sample-${language}`, question: t.demoQuestion, answer: t.demoAnswer,
    language, time: '', demo: true };
  const time = (item: HistoryItem) => item.time ? new Date(item.time).toLocaleString(language === 'ar' ? 'ar-LB' : 'en-US') : t.demoTime;
  return <Modal transparent animationType="slide" onRequestClose={() => selected ? setSelected(null) : onClose()}>
    <View style={s.scrim}>
      <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={t.close} onPress={onClose}/>
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]} accessibilityViewIsModal>
        <View style={s.grabber}/>
        <View style={[s.row, { flexDirection: language === 'ar' ? 'row-reverse' : 'row' }]}>
          <View style={{ flex: 1 }}><Text style={[s.label, direction]}>ECHOSIGHT</Text>
            <Text accessibilityRole="header" style={[s.title, direction]}>{selected ? t.detail : t.historyTitle}</Text>
            {!selected && <Text style={[s.muted, direction]}>{t.historySub}</Text>}</View>
          <Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={onClose} style={s.iconButton}><EchoIcon name="close"/></Pressable>
        </View>
        {selected ? <ScrollView><Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={[s.row, { minHeight: 48 }]}>
          <EchoIcon name="back"/><Text style={s.label}>{t.back}</Text></Pressable>
          <View style={s.detail}>
            <Text style={[s.muted, direction]}>{time(selected)}</Text>
            {selected.demo && <Text style={[s.demo, direction]}>{t.demo}</Text>}
            <Text style={[s.label, direction]}>{t.question}</Text><Text selectable style={[s.text, direction]}>{selected.question}</Text>
            <Text style={[s.label, direction]}>{t.answer}</Text><Text selectable style={[s.text, direction]}>{selected.answer}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t.replay} onPress={() => onReplay(selected)} style={[s.row, s.iconButton]}>
              <EchoIcon name="volume"/><Text style={s.label}>{t.replay}</Text></Pressable>
          </View>
        </ScrollView> : <FlatList data={items.length ? items : [sample, { ...sample, id: `second-${language}`, question: t.demoSecondQuestion, answer: t.demoSecondAnswer }]} keyExtractor={item => item.id}
          renderItem={({ item }) => <Pressable style={[s.historyItem, { flexDirection: language === 'ar' ? 'row-reverse' : 'row' }]}
            accessibilityRole="button" accessibilityLabel={`${item.demo ? t.demo + '. ' : ''}${item.question}. ${t.detail}`}
            onPress={() => setSelected(item)}>
            <EchoIcon name="history"/><View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.muted, direction]}>{time(item)}{item.demo ? ` · ${t.demo}` : ''}</Text>
              <Text style={[s.text, direction]}>{item.question}</Text><Text numberOfLines={2} style={[s.muted, direction]}>{item.answer}</Text>
            </View>
          </Pressable>}/>}
        <Text style={[s.muted, direction]}>{items.length ? t.saved : t.samples}</Text>
      </View>
    </View>
  </Modal>;
}
