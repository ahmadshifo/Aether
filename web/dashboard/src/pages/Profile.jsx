// Member 2: the signed-in person's account, name, appearance, clearing this session's history and logging out.
import { useEffect, useState } from 'react';
import { updateProfile } from '../auth.js';
import { safetyClient } from '../services/safetyClient.js';
import { DynamicButton, HoldToConfirm, Segmented } from '../components/ui/index.js';
import { Avatar, Icon, PageHeader, formatDate } from '../components/ui.jsx';
import { useQuestions } from '../components/useBackend.js';
import { assistantClient } from '../services/assistantClient.js';

const THEMES = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

// The number the phone calls after the user says "I need help" or "SOS". A caregiver sets it here, because
// typing a number on the phone is hard for a blind user.
function SosNumberCard({ authEnabled }) {
  const [number, setNumber] = useState('');
  const [saved, setSaved] = useState(null);
  const [state, setState] = useState('loading'); // loading | idle | busy | done
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authEnabled) return;
    safetyClient.sosNumber()
      .then((value) => { setSaved(value); setNumber(value ?? ''); setState('idle'); })
      .catch((err) => { setError(err.message); setState('idle'); });
  }, [authEnabled]);

  async function submit(event) {
    event.preventDefault();
    setState('busy');
    setError('');
    try {
      const value = await safetyClient.saveSosNumber(number);
      setSaved(value);
      setNumber(value ?? '');
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  }

  return (
    <form className="card section section-tight" onSubmit={submit} aria-labelledby="sos-title">
      <h2 id="sos-title" className="card-title">Emergency number</h2>
      <p className="sub">
        When the user says “I need help” or “SOS”, the phone waits 5 seconds (they can say “cancel”), sends an alert
        here, then calls this number.
      </p>
      <label className="field">Phone number
        <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={number} placeholder="+961 3 123 456"
          disabled={!authEnabled || state === 'loading'} maxLength={24}
          onChange={(event) => { setNumber(event.target.value); if (state === 'done') setState('idle'); }} />
        <span className="hint">{saved ? `The phone calls ${saved}.` : 'No number saved: the alert is still sent, but nobody is called.'}</span>
      </label>
      {error && <p className="form-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
      <DynamicButton type="submit" state={state === 'busy' ? 'busy' : state === 'done' ? 'done' : 'idle'}
        disabled={!authEnabled || state === 'loading' || (state === 'idle' && number.trim() === (saved ?? ''))}
        labels={{ idle: 'Save number', busy: 'Saving…', done: 'Saved' }} />
    </form>
  );
}

export default function Profile({ user, authEnabled, onUserChange, onLogout, theme, onThemeChange }) {
  const [name, setName] = useState(user.name);
  const [save, setSave] = useState('idle'); // idle | busy | done
  const [error, setError] = useState('');
  const changed = name.trim() !== user.name;
  const history = useQuestions();
  const [cleared, setCleared] = useState(null); // number deleted by the last clear
  const [clearError, setClearError] = useState('');
  const [clearKey, setClearKey] = useState(0);
  const real = history.demo ? 0 : history.questions.length;
  const canClear = authEnabled && !history.loading && !history.error && real > 0;
  const clearText = !authEnabled ? 'Log in to manage your question history.'
    : history.loading ? 'Checking your saved questions…'
    : history.error ? `Couldn't check your history: ${history.error}`
    : real > 0 ? `Permanently deletes your ${real} saved question${real === 1 ? '' : 's'} and answers. This can't be undone after 5 seconds.`
    : cleared !== null ? `History cleared (${cleared} deleted).`
    : 'Nothing to clear yet: only sample questions are shown until the assistant answers real ones.';

  async function clearHistory() {
    setClearError('');
    try {
      const { deleted } = await assistantClient.deleteQuestions();
      setCleared(deleted);
      await history.reload();
    } catch (err) {
      setClearError(err.message);
      setClearKey((n) => n + 1); // reset the hold button so it can be tried again
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!changed || save === 'busy') return;
    setSave('busy');
    setError('');
    try {
      onUserChange(await updateProfile(name));
      setSave('done');
    } catch (err) {
      setSave('idle');
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Account / Profile" title="Your profile"
        subtitle="Your account, how the dashboard looks, and this session’s data." />

      <section className="card account" aria-label="Account summary">
        <Avatar large />
        <div>
          <h2 className="card-title">{user.name}</h2>
          <p className="sub">
            {authEnabled ? `${user.email} · member since ${formatDate(user.created_at)}` : 'Preview account · login is off'}
          </p>
        </div>
        <span className="pill pill-ok"><span className="dot" />Watching 1 session</span>
      </section>

      <div className="grid grid-profile">
        <form className="card section" onSubmit={submit} aria-labelledby="details-title">
          <h2 id="details-title" className="card-title">Personal details</h2>
          <label className="field">Name
            <input className="input" type="text" value={name} autoComplete="name" required maxLength={80}
              disabled={!authEnabled}
              onChange={(event) => { setName(event.target.value); if (save === 'done') setSave('idle'); }} />
          </label>
          <label className="field">Email
            <input className="input" type="email" value={authEnabled ? user.email : ''} readOnly
              placeholder={authEnabled ? undefined : 'No email: login is off'} aria-describedby="email-hint" />
            <span id="email-hint" className="hint">Your email is your login and can’t be changed yet.</span>
          </label>
          {error && <p className="form-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
          <DynamicButton type="submit" state={save} disabled={!authEnabled || (save === 'idle' && !changed)}
            labels={{ idle: 'Save changes', busy: 'Saving…', done: 'Saved' }} />
        </form>

        <div className="stack">
          <SosNumberCard authEnabled={authEnabled} />

          <section className="card section" aria-labelledby="look-title">
            <div className="card-head">
              <h2 id="look-title" className="card-title">Appearance</h2>
              <Segmented label="Theme" options={THEMES} value={theme} onChange={onThemeChange} />
            </div>
          </section>

          <section className="card section section-tight" aria-labelledby="clear-title">
            <h2 id="clear-title" className="card-title">Clear question history</h2>
            <p className="sub" aria-live="polite">{clearText}</p>
            {clearError && <p className="form-error" role="alert"><Icon name="alert" size={16} />{clearError}</p>}
            {canClear && (
              <HoldToConfirm key={clearKey} label="Hold to clear history" doneLabel="Clearing…" finalLabel="History cleared"
                undoMessage={(seconds) => `History will be cleared. Undo in ${seconds} s`} onCommit={clearHistory} />
            )}
          </section>

          {authEnabled && (
            <button type="button" className="card row-link" onClick={onLogout}>
              <span>Log out</span>
              <Icon name="logout" size={20} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
