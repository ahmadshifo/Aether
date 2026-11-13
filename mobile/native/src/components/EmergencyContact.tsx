// Settings card: choose the SOS emergency contact from the phone's own contact list. The number is saved to the
// account, so it is the same one the dashboard's Profile page shows (and a caregiver can still change it there).
import React, { useEffect, useState } from 'react';
import { Button, Card, T } from './ui';
import { pickEmergencyContact } from '../platform/sosAlarm';
import { commandCopy } from '../voice/commands';
import type { createTeamApi } from '../services/teamApi';
import type { Language } from '../shared/types';

export function EmergencyContact({ api, language }: { api: ReturnType<typeof createTeamApi>; language: Language }) {
  const copy = commandCopy[language];
  const [number, setNumber] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // The number already saved for this account (for example typed on the dashboard).
  useEffect(() => {
    void api.sosNumber?.(new AbortController().signal).then(setNumber).catch(() => {});
  }, [api]);

  async function choose() {
    setBusy(true);
    setStatus('');
    try {
      const picked = await pickEmergencyContact();
      if (picked === 'no_number') { setStatus(copy.contactNoNumber); return; }
      if (!picked) return;  // closed without choosing
      const saved = await api.saveSosNumber(picked.number, new AbortController().signal);
      setNumber(saved);
      setName(picked.name);
      setStatus(copy.contactSaved);
    } catch {
      setStatus(commandCopy[language].sosFailed ?? 'Could not save the contact.');
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <T variant="heading">SOS</T>
    <T accessibilityLiveRegion="polite">{number ? `${name ? `${name} · ` : ''}${number}` : copy.contactNone}</T>
    <Button label={copy.chooseContact} icon="search" onPress={() => { void choose(); }} disabled={busy} />
    {!!status && <T variant="small" accessibilityLiveRegion="polite">{status}</T>}
  </Card>;
}
