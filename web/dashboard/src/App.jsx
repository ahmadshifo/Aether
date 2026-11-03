// Member 2: dashboard shell: the Option B sidebar and hash routes (#/overview, #/memory/{frame_id}, ...).
import { useEffect, useRef, useState } from 'react';
import { getCurrentUser, logout } from './auth.js';
import { Avatar, Icon, UserContext } from './components/ui.jsx';
import { Mark, Wordmark } from './components/ui/index.js';
import { STATUS } from './data/mockData.js';
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
  { id: 'history', label: 'AI history', icon: 'chat', Page: AiHistory },
  { id: 'status', label: 'System status', icon: 'activity', Page: SystemStatus },
  { id: 'profile', label: 'Profile', icon: 'user', Page: Profile },
];

const THEME_KEY = 'echosight-theme';

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Light is the design; dark is only used when picked on the Profile page, and the pick is remembered.
function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#FCFCFC');
  }, [theme]);

  const setTheme = (next) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not persisted */ }
  };
  return [theme, setTheme];
}

function readRoute() {
  const [, page = 'overview', param] = window.location.hash.split('/');
  return { page, param };
}

const AUTH_PAGES = ['login', 'signup'];

// Login is on by default; set VITE_AUTH_ENABLED=false in .env to preview the dashboard with mock data and no backend.
const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false';
const PREVIEW_USER = { user_id: null, email: 'Mock data · login off', name: 'Team preview', created_at: null };

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [theme, setTheme] = useTheme();
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
    document.title = signedOut ? `${authMode === 'signup' ? 'Sign up' : 'Log in'} · Aether` : `${current.label} · Aether`;
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

  const streaming = STATUS.streaming === 'online';

  return (
    <UserContext.Provider value={user}>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <div className="shell">
        <aside className="sidebar card">
          <a href="#/overview" className="brand" aria-label="Aether home">
            <Mark />
            <Wordmark />
          </a>

          <nav className="nav" aria-label="Workspace">
            <p className="label">Workspace</p>
            <ul>
              {NAV.map((item) => (
                <li key={item.id}>
                  <a href={`#/${item.id}`} className="nav-link" aria-current={item.id === current.id ? 'page' : undefined}>
                    <span className="nav-tile"><Icon name={item.icon} /></span>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <a href="#/live" className={`stream-card inset${streaming ? '' : ' is-off'}`}>
            <span className="label"><span className="dot" />{streaming ? 'Phone streaming' : 'Phone offline'}</span>
            <span className="stream-card-text">Watch what the phone sees</span>
            <span className="btn btn-sm">Open live camera</span>
          </a>

          <div className="sidebar-foot">
            <a href="#/profile" className="foot-profile" aria-label={`Your profile: ${user.name}`}>
              <Avatar />
              <span className="foot-who">
                <span className="foot-name">{user.name}</span>
                <span className="foot-email" title={user.email}>{user.email}</span>
              </span>
            </a>
            {AUTH_ENABLED && (
              <button type="button" className="foot-logout" onClick={handleLogout} aria-label="Log out" title="Log out">
                <Icon name="logout" size={17} />
              </button>
            )}
          </div>
        </aside>

        <main ref={mainRef} className="main" tabIndex={-1}>
          <current.Page key={current.id + (route.param ?? '')} param={route.param}
            user={user} authEnabled={AUTH_ENABLED} onUserChange={setUser} onLogout={handleLogout}
            theme={theme} onThemeChange={setTheme} />
        </main>
      </div>
    </UserContext.Provider>
  );
}
