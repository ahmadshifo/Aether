// Member 2: email + password login and account creation, shown instead of the dashboard until someone is signed in.
import { useState } from 'react';
import { login, signup } from '../auth.js';
import { Mark, Segmented, TactileButton, Wordmark } from '../components/ui/index.js';
import { Icon } from '../components/ui.jsx';

const MODES = [{ value: 'login', label: 'Log in' }, { value: 'signup', label: 'Sign up' }];

export default function AuthPage({ mode, initialError = '', onSignedIn }) {
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const go = (next) => { window.location.hash = `#/${next}`; };

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = isSignup
        ? await signup(form.name, form.email, form.password)
        : await login(form.email, form.password);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-grid">
        <section className="card auth-about" aria-label="About Aether">
          <span className="brand"><Mark /><Wordmark /></span>
          <div className="auth-hero">
            <Mark size={150} />
            <h1 className="page-title">See what the phone sees, live</h1>
            <p className="sub">The camera, every saved frame and every answer the assistant gave, in one place.</p>
          </div>
          <span className="label">No face recognition · frames deleted after 24 h</span>
        </section>

        <form className="card auth-form" onSubmit={submit} aria-labelledby="auth-title">
          <Segmented label="Log in or sign up" options={MODES} value={mode} onChange={go} large />
          <div>
            <h2 id="auth-title" className="page-title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="sub">{isSignup ? 'Watch the phone camera and the assistant’s answers.' : 'Log in to watch the live session.'}</p>
          </div>

          {isSignup && (
            <label className="field">Name
              <input className="input" type="text" value={form.name} onChange={update('name')} autoComplete="name"
                placeholder="Your name" required maxLength={80} />
            </label>
          )}
          <label className="field">Email
            <input className="input" type="email" value={form.email} onChange={update('email')} autoComplete="email"
              placeholder="you@example.com" required maxLength={254} />
          </label>
          <label className="field">Password
            <input className="input" type="password" value={form.password} onChange={update('password')}
              autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="At least 8 characters"
              required minLength={isSignup ? 8 : undefined} maxLength={128} />
          </label>

          {error && <p className="form-error" role="alert"><Icon name="alert" size={16} />{error}</p>}

          <div className="auth-actions">
            <TactileButton type="submit" disabled={busy}>
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
              <Icon name="arrow" size={18} strokeWidth="2" />
            </TactileButton>
            <button type="button" className="btn" onClick={() => go(isSignup ? 'login' : 'signup')}>
              {isSignup ? 'I already have an account' : 'Create an account'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
