// Member 2: email + password login and account creation, shown instead of the dashboard until someone is signed in.
import { useState } from 'react';
import { login, signup } from '../auth.js';
import { Icon } from '../components/ui.jsx';

export default function AuthPage({ mode, initialError = '', onSignedIn }) {
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

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
    <div className="auth-shell">
      <main className="auth-card card">
        <div className="brand auth-brand">
          <span className="brand-mark"><Icon name="eye" size={20} /></span>
          <span className="brand-name">echosight</span>
        </div>

        <h1 className="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="page-subtitle">
          {isSignup ? 'Sign up with your email to open the dashboard.' : 'Log in with your email to open the dashboard.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {isSignup && (
            <div className="field">
              <label htmlFor="auth-name">Name</label>
              <input id="auth-name" type="text" value={form.name} onChange={update('name')} autoComplete="name"
                required maxLength={80} />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" value={form.email} onChange={update('email')} autoComplete="email"
              required maxLength={254} />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <span className="field-row">
              <input id="auth-password" type={showPassword ? 'text' : 'password'} value={form.password}
                onChange={update('password')} autoComplete={isSignup ? 'new-password' : 'current-password'}
                required minLength={isSignup ? 8 : undefined} maxLength={128}
                aria-describedby={isSignup ? 'password-hint' : undefined} />
              <button type="button" className="field-toggle" onClick={() => setShowPassword(!showPassword)}
                aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
            {isSignup && <span id="password-hint" className="field-hint">At least 8 characters.</span>}
          </div>

          {error && <p className="auth-error" role="alert"><Icon name="alert" size={16} />{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? 'Already have an account? ' : 'New to echosight? '}
          <a href={isSignup ? '#/login' : '#/signup'} className="link-accent">
            {isSignup ? 'Log in' : 'Create an account'}
          </a>
        </p>
      </main>
    </div>
  );
}
