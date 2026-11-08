import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Button, Card, Field, Notice, Row, Sheet, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
import { historyStreamCopy } from '../i18n/historyStreamCopy';
import type { HistorySync, HistorySyncState } from '../storage/historySync';
import { dateGroup, searchHistory, type HistoryRepository, type HistoryState } from '../storage/history';
import { imageUri } from '../storage/nativeStorage';
import type { Entry, Language } from '../shared/types';
export function entryTime(entry: Entry, language: Language) { return new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : language === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt)); }
export function HistoryScreen({ repository, state, sync, network, stopSession, replay, active, speaking, stopSpeech, focus }: { repository: HistoryRepository; state: HistoryState; sync?: HistorySync; network?: HistorySyncState; stopSession?(): void; replay(entry: Entry): void; active: boolean; speaking: boolean; stopSpeech(): void; focus(): void }) {
  const { language, colors } = useUI(), { u, n } = copies(language), h = historyStreamCopy[language];
  const busy = state.loading || !!network && ['refreshing', 'more', 'clearing'].includes(network.status);
  const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState<string>(), [expanded, setExpanded] = useState<string[]>([]), [zoom, setZoom] = useState(0), [clear, setClear] = useState(false), [notice, setNotice] = useState(''), [fallback, setFallback] = useState('');
  const generation = useRef(0); useEffect(() => () => { generation.current++; }, []);
  const selected = state.items.find(row => row.id === selectedId), visible = searchHistory(state.items, query);
  const textFor = (entry: Entry) => { const t = copies(entry.language).u; return `${copies(entry.language).n.serverAnswer}${entry.uncertain ? ` · ${copies(entry.language).n.uncertain}` : ''}\n\n${t.question}: ${entry.question}\n\n${t.answer}: ${entry.answer}\n\n${entryTime(entry, language)}`; };
  async function copy(entry: Entry) {
    const g = generation.current, text = textFor(entry);
    try { if (!(await Clipboard.setStringAsync(text))) throw Error(); if (g === generation.current) setNotice(u.copied); }
    catch { if (g === generation.current) setFallback(text); }
  }
  async function share(entry: Entry, photo = false) {
    const g = generation.current;
    try {
      if (photo && entry.photo && await Sharing.isAvailableAsync()) await Sharing.shareAsync(imageUri(repository.key, entry.photo), { mimeType: 'image/jpeg', dialogTitle: 'Aether', UTI: 'public.jpeg' });
      else {
        const result = await Share.share({ title: 'Aether', message: textFor(entry) });
        if (g === generation.current && result.action === Share.dismissedAction) setNotice(n.shareCancelled);
      }
    } catch { if (g === generation.current) { setNotice(u.shareFailed); setFallback(textFor(entry)); } }
  }
  const remove = (entry: Entry) => { if (sync) sync.removeLocal(entry); else repository.remove(entry.id); setSelectedId(undefined); setZoom(0); setNotice(h.removedLocal); };
  async function clearHistory() {
    const g = generation.current;
    stopSession?.(); stopSpeech();
    const success = sync ? await sync.clear() : (repository.clear(), true);
    if (g !== generation.current) return;
    if (success) { setSelectedId(undefined); setZoom(0); setClear(false); setNotice(sync ? h.cleared : u.cleared); }
  }
  function photo(entry: Entry, press = false) {
    return entry.photo ? <Pressable accessibilityRole={press ? 'button' : 'image'} accessibilityLabel={press ? u.zoom : u.photoAlt} disabled={!press} onPress={() => setZoom(1)} style={{ minHeight: 180, borderRadius: 10, overflow: 'hidden' }}>
      <Image accessible={false} source={{ uri: imageUri(repository.key, entry.photo) }} style={{ width: '100%', height: 200 }} resizeMode="cover" onError={() => setNotice(u.storageError)} />
    </Pressable> : <View style={{ padding: 24, backgroundColor: colors.inset, borderRadius: 10 }}><T variant="small">{u.noPhoto}</T></View>;
  }
  function actions(entry: Entry, detail = false) {
    return <View style={{ gap: 8 }}><Row><Button label={u.replay} icon="volume" onPress={() => active ? setNotice(u.replayActive) : replay(entry)} /><Button label={u.copy} icon="copy" onPress={() => { void copy(entry); }} />{repository.getSnapshot().items.some(row => row.id === entry.id) && <Button danger disabled={busy} label={h.removeLocal} icon="trash" onPress={() => remove(entry)} />}</Row>
      {speaking && <Button label={n.stopSpeech} onPress={stopSpeech} />}
      {detail && <><Button label={u.share} onPress={() => { void share(entry); }} />{entry.photo && <Button label={h.sharePhoto} onPress={() => { void share(entry, true); }} />}</>}
    </View>;
  }
  return <View style={{ gap: 20 }}><T variant="title" accessibilityRole="header">{u.history}</T><Row>{sync && <Button label={h.refresh} disabled={busy} onPress={() => { void sync.refresh(); }} />}<Button label={sync ? h.clear : u.clear} onPress={() => setClear(true)} disabled={busy || !sync && !state.items.length} /></Row>
    {network && ['refreshing', 'more', 'clearing'].includes(network.status) && <T accessibilityLiveRegion="polite">{network.status === 'clearing' ? h.clearing : network.status === 'more' ? h.loadingMore : h.refreshing}</T>}
    {network?.error && <Notice danger>{network.error === 'clear' ? h.clearError : network.error === 'more' ? h.moreError : h.offline}</Notice>}
    {sync && network?.error && <Button label={h.retry} disabled={busy} onPress={() => { void sync.retry(); }} />}
    <Field label={u.search} value={query} onChangeText={setQuery} placeholder={u.searchPlaceholder} />{!!query && <Button label={u.clearSearch} onPress={() => setQuery('')} />}
    {!!query && network?.nextCursor && <T variant="small">{h.searchHint}</T>}
    {state.error && <Notice danger>{u.storageError}</Notice>}
    {state.loading ? <T accessibilityLiveRegion="polite">{u.loading}</T> : !visible.length ? <Card><T variant="heading">{state.items.length ? u.noResults : u.emptyTitle}</T><T>{state.items.length ? u.noResultsHint : u.emptyBody}</T></Card> : (['today', 'yesterday', 'earlier'] as const).map(group => {
      const rows = visible.filter(row => dateGroup(row) === group);
      return rows.length ? <View key={group} style={{ gap: 12 }}><T variant="small">{u[group]} · {new Intl.NumberFormat(language).format(rows.length)}</T>{rows.map(entry => <Card key={entry.id} style={{ padding: 16 }}>
        <Row><T variant="small">{entryTime(entry, language)}</T><T variant="label">{entry.language.toUpperCase()}</T><T variant="small">{n.serverAnswer}</T></Row>
        {entry.input === 'typed' && <T variant="small">{n.typed}</T>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.includes(entry.id) }} onPress={() => setExpanded(current => current.includes(entry.id) ? current.filter(id => id !== entry.id) : [...current, entry.id])} style={{ minHeight: 48, justifyContent: 'center' }}><T language={entry.language} variant="heading">{entry.question} {expanded.includes(entry.id) ? '−' : '+'}</T></Pressable>
        {expanded.includes(entry.id) && <><T language={entry.language}>{entry.answer}</T>{photo(entry)}</>}
        <Button label={u.readMore} onPress={() => setSelectedId(entry.id)} />{actions(entry)}
      </Card>)}</View> : null;
    })}
    {sync && network?.nextCursor && <Button label={h.more} disabled={busy} onPress={() => { void sync.more(); }} />}
    {(notice || state.undo) && <Card><T accessibilityLiveRegion="polite">{notice}</T>{state.undo && <Button label={u.undo} disabled={busy} onPress={() => { if (sync) sync.restoreLocal(); else repository.restore(); setNotice(u.restored); }} />}<Button label={u.dismiss} onPress={() => { repository.dismissUndo(); setNotice(''); }} /></Card>}
    {selected && !zoom && <Sheet title={u.detail} onClose={() => setSelectedId(undefined)} restoreFocus={focus}>{photo(selected, true)}<T variant="small">{entryTime(selected, language)} · {selected.language.toUpperCase()}</T><Notice>{n.serverAnswer}</Notice>{selected.uncertain && <Notice>{n.uncertain}</Notice>}{!!selected.evidenceFrameIds?.length && <T>{n.evidence}: {selected.evidenceFrameIds.length}</T>}{selected.input === 'typed' && <T variant="small">{n.typed}</T>}<T variant="heading">{u.question}</T><T language={selected.language}>{selected.question}</T><T variant="heading">{u.answer}</T><T language={selected.language}>{selected.answer}</T>{actions(selected, true)}{!!notice && <T accessibilityLiveRegion="polite">{notice}</T>}</Sheet>}
    {selected?.photo && zoom > 0 && <Sheet title={u.zoomTitle} onClose={() => setZoom(0)}><Row><Button label={u.zoomOut} disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - .5))} /><Button label={u.zoomReset} onPress={() => setZoom(1)} /><Button label={u.zoomIn} disabled={zoom >= 3} onPress={() => setZoom(Math.min(3, zoom + .5))} /></Row><T>{new Intl.NumberFormat(language, { style: 'percent' }).format(zoom)}</T><ScrollView horizontal><ScrollView><Image accessibilityLabel={u.photoAlt} source={{ uri: imageUri(repository.key, selected.photo) }} style={{ width: 300 * zoom, height: 200 * zoom }} resizeMode="contain" /></ScrollView></ScrollView></Sheet>}
    {clear && <Sheet title={sync ? h.clearTitle : u.clearTitle} onClose={() => { if (!busy) setClear(false); }} restoreFocus={focus}><T>{sync ? h.clearBody : u.clearBody}</T>{network?.error === 'clear' && <Notice danger>{h.clearError}</Notice>}{network?.status === 'clearing' && <T accessibilityLiveRegion="polite">{h.clearing}</T>}<Button label={u.cancel} disabled={busy} onPress={() => setClear(false)} /><Button danger label={sync ? h.clear : u.clear} disabled={busy} onPress={() => { void clearHistory(); }} /></Sheet>}
    {!!fallback && <Sheet title={u.copyFallback} onClose={() => setFallback('')}><T>{u.copyHelp}</T><T selectable>{fallback}</T></Sheet>}
  </View>;
}
