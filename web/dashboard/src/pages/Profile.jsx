// Member 2: the signed-in person's profile: name, email, appearance, this session's activity and sign-out.
import { useState } from 'react';
import { updateProfile } from '../auth.js';
import { Avatar, Icon, PageHeader, formatDateTime } from '../components/ui.jsx';
import { FRAMES, QUESTIONS } from '../data/mockData.js';

const ACTIVITY = [
  ['Questions asked', QUESTIONS.length],
  ['Answered in Arabic', QUESTIONS.filter((q) => q.language === 'ar').length],
  ['“Not sure” answers', QUESTIONS.filter((q) => q.uncertain).length],
  ['Frames saved', FRAMES.length],
];

export default function Profile({ user, authEnabled, onUserChange, onLogout, theme, onToggleTheme }) {
  const [name, setName] = useState(user.name);
  const [state, setState] = useState({ busy: false, message: '', error: '' });
  const changed = name.trim() !== user.name;

  async function save(event) {
    event.preventDefault();
    setState({ busy: true, message: '', error: '' });
    try {
      onUserChange(await updateProfile(name));
      setState({ busy: false, message: 'Saved.', error: '' });
    } catch (err) {
      setState({ busy: false, message: '', error: err.message });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Account / Profile"
        title="Your profile"
        subtitle="Your account details and how the dashboard looks for you."
      />

      <section className="card profile-hero" aria-label="Account summary">
        <Avatar className="avatar-lg" />
        <div className="profile-who">
          <p className="profile-name">{user.name}</p>
          <p className="muted-sm">{user.email}</p>
        </div>
        {authEnabled
          ? <span className="pill pill-ok">Member since {formatDateTime(user.created_at).split(' · ')[0]}</span>
          : <span className="pill pill-warn">Preview account</span>}
      </section>

      <div className="profile-grid">
        <section className="card" aria-labelledby="details-title">
          <div className="card-head">
            <div>
              <h2 id="details-title" className="card-title">Personal details</h2>
              <p className="card-sub">Shown in the sidebar and on the overview greeting.</p>
            </div>
          </div>
          <form className="auth-form profile-form" onSubmit={save}>
            <div className="field">
              <label htmlFor="profile-name">Name</label>
              <input id="profile-name" type="text" value={name} onChange={(event) => setName(event.target.value)}
                autoComplete="name" required maxLength={80} disabled={!authEnabled} />
            </div>
            <div className="field">
              <label htmlFor="profile-email">Email</label>
              <input id="profile-email" type="email" value={authEnabled ? user.email : ''} readOnly disabled
                placeholder={authEnabled ? undefined : 'No email: login is off'} aria-describedby="email-hint" />
              <span id="email-hint" className="field-hint">Your email is your login and can't be changed yet.</span>
            </div>

            {state.error && <p className="auth-error" role="alert"><Icon name="alert" size={16} />{state.error}</p>}

            {authEnabled ? (
              <div className="profile-actions">
                <button type="submit" className="btn btn-primary" disabled={!changed || state.busy}>
                  {state.busy ? 'Saving…' : 'Save changes'}
                </button>
                <span className="muted-sm" aria-live="polite">{state.message}</span>
              </div>
            ) : (
              <p className="note"><Icon name="alert" size={16} />
                Login is switched off, so this is a preview account. Set VITE_AUTH_ENABLED=true to edit a real profile.
              </p>
            )}
          </form>
        </section>

        <div className="side-stack">
          <section className="card" aria-labelledby="appearance-title">
            <h2 id="appearance-title" className="card-title">Appearance</h2>
            <p className="card-sub">Saved on this device.</p>
            <div className="segmented profile-theme" role="group" aria-label="Theme">
              {['light', 'dark'].map((option) => (
                <button key={option} type="button" aria-pressed={theme === option}
                  onClick={() => theme !== option && onToggleTheme()}>
                  <Icon name={option === 'light' ? 'sun' : 'moon'} size={15} />
                  {option === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="activity-title">
            <h2 id="activity-title" className="card-title">This session</h2>
            <dl className="profile-stats">
              {ACTIVITY.map(([label, value]) => (
                <div key={label}>
                  <dt className="muted-sm">{label}</dt>
                  <dd className="stat-value">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="field-hint profile-retention">
              <Icon name="clock" size={14} /> Questions and frames are deleted after 24 hours.
            </p>
          </section>

          {authEnabled && (
            <section className="card" aria-labelledby="signout-title">
              <h2 id="signout-title" className="card-title">Sign out</h2>
              <p className="card-sub">Ends your session on this browser.</p>
              <button type="button" className="btn profile-signout" onClick={onLogout}>
                <Icon name="logout" size={16} />Log out
              </button>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
