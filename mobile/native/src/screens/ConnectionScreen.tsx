import React, { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Field, Mark, Notice, Row, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
import { historyStreamCopy } from '../i18n/historyStreamCopy';
import { boundedFetch, probeBackend, validateEndpoints, type Endpoints } from '../platform/config';
import type { SessionState } from '../session/controller';
import { nativeFetch } from '../platform/network';
import { inspectTeamApi, unknownFeatures, type TeamFeatures } from '../services/teamApi';
export function ConnectionScreen({ endpoints, onSave, session, signedIn }: { endpoints: Endpoints; onSave(value: Endpoints): void; session?: SessionState; signedIn: boolean }) {
  const { language, colors } = useUI(), { m, n } = copies(language);
  const transportLabel = session?.transport === 'connected' ? n.transportConnected : session?.transport === 'reconnecting' ? historyStreamCopy[language].reconnecting : session?.transport === 'failed' ? n.transportFailed : session?.transport === 'connecting' ? n.pending : session?.camera ? m.cameraPreview : m.off;
  const [draft, setDraft] = useState(endpoints), [message, setMessage] = useState(''), [authStatus, setAuthStatus] = useState(n.unknown), [mediaStatus, setMediaStatus] = useState(n.unknown), [busy, setBusy] = useState(false);
  const epoch = useRef(0); useEffect(() => () => { epoch.current++; }, []);
  const [features, setFeatures] = useState<TeamFeatures>(unknownFeatures);
  const edit = (patch: Partial<Endpoints>) => { epoch.current++; setBusy(false); setDraft({ ...draft, ...patch }); setFeatures(unknownFeatures); setAuthStatus(n.unknown); setMediaStatus(n.unknown); setMessage(''); };
  async function check() {
    const g = ++epoch.current; setBusy(true); setMessage('');
    try {
      const valid = validateEndpoints(draft);
      await probeBackend(valid.backend, nativeFetch);
      const available = await inspectTeamApi(valid.backend, nativeFetch);
      if (g === epoch.current) setFeatures(available);
      // A public check proves reachability only. /me is not used to unlock this view.
      if (g === epoch.current) setAuthStatus(`${n.reachable} · ${signedIn && valid.backend === endpoints.backend ? n.authenticated : n.signedOut}`);
      try {
        const response = await boundedFetch(`${valid.media}/`, { method: 'OPTIONS', credentials: 'omit' }, 5000, nativeFetch);
        if (g === epoch.current) setMediaStatus(response.status < 500 ? n.signalingReachable : n.signalingUnavailable);
      } catch { if (g === epoch.current) setMediaStatus(n.signalingUnavailable); }
    } catch (error) { if (g === epoch.current) { setAuthStatus(n.unknown); setMessage(n[error instanceof Error ? error.message as keyof typeof n : 'backend_unavailable'] as string || n.backend_unavailable); } }
    finally { if (g === epoch.current) setBusy(false); }
  }
  return <View style={{ gap: 24 }}><Row><T variant="title" accessibilityRole="header" style={{ flex: 1 }}>{m.connection}</T><Button label={busy ? n.checking : m.check} disabled={busy} onPress={() => { void check(); }} /></Row>
    <Card style={{ padding: 0 }}><Row style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}><View style={{ flex: 1, padding: 20, gap: 16 }}><T variant="label">{m.ticket}</T><T selectable style={{ fontFamily: 'JetBrainsMono' }}>{session?.id ?? m.noSession}</T><T variant="small">{session?.id ? session.active ? session.startedAt : n.stopped : null}</T></View><View style={{ padding: 16, borderLeftWidth: 1, borderColor: colors.line, borderStyle: 'dashed', justifyContent: 'center' }}><Mark size={32} /></View></Row></Card>
    <Button label={m.copyId} disabled={!session?.id} onPress={() => { const g = epoch.current; void Clipboard.setStringAsync(session!.id!).then(ok => { if (g === epoch.current) setMessage(ok ? m.copied : m.copyFallback); }).catch(() => { if (g === epoch.current) setMessage(m.copyFallback); }); }} />
    <Card><T>{n.backend}: {authStatus}</T><T>{n.signaling}: {mediaStatus}</T><T>{m.stream}: {transportLabel}</T><T>{n.registry}: {session?.registry === 'registered' ? n.registered : session?.registry === 'failed' ? n.registry_failed : session?.registry === 'pending' ? n.pending : n.off}</T><T>{m.ai}: {features.answers === 'available' ? n.routeAvailable : features.answers === 'missing' ? n.routeMissing : n.unknown}</T><T variant="small">{n.routeNote}</T></Card>
    <Field label={n.backend} value={draft.backend} onChangeText={backend => edit({ backend })} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ textAlign: 'left', writingDirection: 'ltr' }} />
    <Field label={n.media} value={draft.media} onChangeText={media => edit({ media })} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ textAlign: 'left', writingDirection: 'ltr' }} />
    <Row><T style={{ flex: 1 }}>{n.lan}</T><Switch accessibilityLabel={n.lan} value={draft.allowLan} onValueChange={allowLan => edit({ allowLan })} /></Row><T variant="small">{n.lanNote}</T>
    <T variant="small">{n.connectionNote}</T><Button primary label={n.save} onPress={() => { try { const value = validateEndpoints(draft); onSave(value); } catch (error) { setMessage(n[error instanceof Error ? error.message as keyof typeof n : 'invalid_origin'] as string || n.invalid_origin); } }} />
    {!!message && <Notice>{message}</Notice>}
  </View>;
}
