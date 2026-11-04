// Member 2: the signed-in person's account, name, appearance, clearing this session's history and logging out.
import { useState } from 'react';
import { updateProfile } from '../auth.js';
import { DynamicButton, HoldToConfirm, Segmented } from '../components/ui/index.js';
import { Avatar, Icon, PageHeader, formatDate } from '../components/ui.jsx';
import { QUESTIONS } from '../data/mockData.js';

const THEMES = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

export default function Profile({ user, authEnabled, onUserChange, onLogout, theme, onThemeChange }) {
  const [name, setName] = useState(user.name);
  const [save, setSave] = useState('idle'); // idle | busy | done
  const [error, setError] = useState('');
  const changed = name.trim() !== user.name;

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
          <section className="card section" aria-labelledby="look-title">
            <div className="card-head">
              <h2 id="look-title" className="card-title">Appearance</h2>
              <Segmented label="Theme" options={THEMES} value={theme} onChange={onThemeChange} />
            </div>
          </section>

          <section className="card section section-tight" aria-labelledby="clear-title">
            <h2 id="clear-title" className="card-title">Clear question history</h2>
            <p className="sub">Removes the {QUESTIONS.length} saved questions and answers from this session.</p>
            <HoldToConfirm label="Hold to clear history" doneLabel="History cleared" finalLabel="History cleared"
              undoMessage={(seconds) => `History cleared. Undo in ${seconds} s`} />
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
