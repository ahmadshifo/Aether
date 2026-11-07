import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Notice, useUI } from './ui';
import { copies } from '../i18n/nativeCopy';
import type { AuthController, AuthSession } from '../auth/authController';
import type { createTeamApi } from '../services/teamApi';
export function ProfileSettings({ api, auth, session }: { api: ReturnType<typeof createTeamApi>; auth: AuthController; session: AuthSession }) {
  const { language } = useUI(), { n } = copies(language);
  const [name, setName] = useState(session.user.name), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => { const off = auth.onLock(() => request.current?.abort()); return () => { request.current?.abort(); off(); }; }, [auth]);
  async function save() {
    if (busy || !auth.authorized(session.owner)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('');
    try {
      const user = await api.updateName(name, session.user.user_id, controller.signal);
      if (controller.signal.aborted || !auth.authorized(session.owner)) return;
      auth.updateProfile(user, session.owner); setName(user.name); setMessage(n.profileSaved);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(n[error instanceof Error ? error.message as keyof typeof n : 'server_unavailable'] as string || n.server_unavailable);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <><Field label={n.profileName} value={name} onChangeText={setName} editable={!busy} autoComplete="name" />
    <Button label={busy ? n.saving : n.saveName} disabled={busy || !name.trim() || name.trim() === session.user.name} onPress={() => { void save(); }} />
    {!!message && <Notice>{message}</Notice>}</>;
}
