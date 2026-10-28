// Member 2: dashboard shell with the workspace sidebar and hash routes (#/overview, #/memory/{frame_id}, ...).
import { useEffect, useRef, useState } from 'react';
import { getCurrentUser, logout } from './auth.js';
import { Avatar, Icon, UserContext } from './components/ui.jsx';
import AiHistory from './pages/AiHistory.jsx';
import AuthPage from './pages/AuthPage.jsx';
import LiveCamera from './pages/LiveCamera.jsx';
import Overview from './pages/Overview.jsx';
import Profile from './pages/Profile.jsx';
import SystemStatus from './pages/SystemStatus.jsx';
import VisualMemory from './pages/VisualMemory.jsx';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'home', Page: Overview },
  { id: 'live', label: 'Live camera', icon: 'video', Page: LiveCamera },
  { id: 'memory', label: 'Visual memory', icon: 'image', Page: VisualMemory },
  { id: 'history', label: 'AI history', icon: 'clock', Page: AiHistory },
  { id: 'status', label: 'System status', icon: 'activity', Page: SystemStatus },
  { id: 'profile', label: 'Profile', icon: 'user', Page: Profile },
];

const THEME_KEY = 'echosight-theme';
const systemTheme = () => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked: follow the OS */ }
  return systemTheme();
}

// Light/dark theme: follows the OS until the user picks one, then remembers the pick.
function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f6f7' : '#0a1a23');
  }, [theme]);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not persisted */ }
  };
  return [theme, toggle];
}

function readRoute() {
  const [, page = 'overview', param] = window.location.hash.split('/');
  return { page, param };
}

const AUTH_PAGES = ['login', 'signup'];

// Login is off until the team has the backend and database running: set VITE_AUTH_ENABLED=true in .env to turn it on.
const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';
const PREVIEW_USER = { user_id: null, email: 'Mock data', name: 'Team preview', created_at: null };

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [theme, toggleTheme] = useTheme();
  // undefined = still checking, null = signed out
  const [user, setUser] = useState(AUTH_ENABLED ? undefined : PREVIEW_USER);
  const [authError, setAuthError] = useState('');
  const mainRef = useRef(null);
  const current = NAV.find((item) => item.id === route.page) ?? NAV[0];

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    getCurrentUser().then(setUser).catch((error) => { setAuthError(error.message); setUser(null); });
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
      mainRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const signedOut = user === null;
  const authMode = route.page === 'signup' ? 'signup' : 'login';

  useEffect(() => {
    if (user === undefined) return;
    document.title = signedOut ? `${authMode === 'signup' ? 'Sign up' : 'Log in'} · echosight` : `${current.label} · echosight`;
  }, [current, user, signedOut, authMode]);

  // Signed in on #/login or #/signup → go to the dashboard; signed out elsewhere → go to #/login.
  useEffect(() => {
    if (user && AUTH_PAGES.includes(route.page)) window.location.replace('#/overview');
    if (signedOut && !AUTH_PAGES.includes(route.page)) window.location.replace('#/login');
  }, [user, signedOut, route.page]);

  async function handleLogout() {
    try { await logout(); } catch { /* cookie may already be gone */ }
    setUser(null);
  }

  if (user === undefined) return null;

  if (signedOut) {
    return (
      <AuthPage key={authMode} mode={authMode} initialError={authError}
        onSignedIn={(signedIn) => { setAuthError(''); setUser(signedIn); }} />
    );
  }

  return (
    <UserContext.Provider value={user}>
    <div className="shell">
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>

      <aside className="sidebar">
        <a href="#/overview" className="brand" aria-label="echosight home">
          <span className="brand-mark"><Icon name="eye" size={20} /></span>
          <span className="brand-name">echosight</span>
        </a>

        <nav aria-label="Workspace">
          <p className="nav-heading">Workspace</p>
          <ul className="nav-list">
            {NAV.map((item) => (
              <li key={item.id}>
                <a href={`#/${item.id}`} className="nav-link"
                  aria-current={item.id === current.id ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <a href="#/profile" className="foot-profile" aria-label={`Your profile: ${user.name}`}>
            <Avatar />
            <span className="foot-who">
              <span className="foot-name">{user.name}</span>
              <span className="foot-sub" title={user.email}>{user.email}</span>
            </span>
          </a>
          {AUTH_ENABLED && (
            <button type="button" className="icon-btn logout-btn" onClick={handleLogout}
              aria-label="Log out" title="Log out">
              <Icon name="logout" size={16} />
            </button>
          )}
          <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
          </button>
        </div>
      </aside>

      <main ref={mainRef} className="main" tabIndex={-1}>
        <current.Page key={current.id + (route.param ?? '')} param={route.param}
          user={user} authEnabled={AUTH_ENABLED} onUserChange={setUser} onLogout={handleLogout}
          theme={theme} onToggleTheme={toggleTheme} />
      </main>
    </div>
    </UserContext.Provider>
  );
}
