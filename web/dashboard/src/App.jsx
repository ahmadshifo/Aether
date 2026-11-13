// Member 2: dashboard shell: the Option B sidebar and routes (/overview, /memory/{frame_id}, ...).
import { useEffect, useRef, useState } from 'react';
import { Link, matchPath, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { AUTH_ENABLED, getCurrentUser, logout } from './auth.js';
import { Avatar, Icon, UserContext } from './components/ui.jsx';
import { Mark, Wordmark } from './components/ui/index.js';
import SosAlerts from './components/SosAlerts.jsx';
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
  { id: 'memory', path: 'memory/:frameId?', label: 'Visual memory', icon: 'image', Page: VisualMemory },
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

const PREVIEW_USER = { user_id: null, email: 'Mock data · login off', name: 'Team preview', created_at: null };

const routePath = (item) => `/${item.path ?? item.id}`;

export default function App() {
  const [theme, setTheme] = useTheme();
  // undefined = still checking, null = signed out
  const [user, setUser] = useState(AUTH_ENABLED ? undefined : PREVIEW_USER);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    getCurrentUser().then(setUser).catch((error) => { setAuthError(error.message); setUser(null); });
  }, []);

  async function handleLogout() {
    try { await logout(); } catch { /* cookie may already be gone */ }
    setUser(null);
  }

  if (user === undefined) return null;

  if (user === null) {
    const authPage = (mode) => (
      <AuthPage key={mode} mode={mode} initialError={authError}
        onSignedIn={(signedIn) => { setAuthError(''); setUser(signedIn); }} />
    );
    return (
      <Routes>
        <Route path="/login" element={authPage('login')} />
        <Route path="/signup" element={authPage('signup')} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell user={user} onUserChange={setUser} onLogout={handleLogout} theme={theme} onThemeChange={setTheme} />
  );
}

function Shell({ user, onUserChange, onLogout, theme, onThemeChange }) {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const previousPath = useRef(pathname);
  const current = NAV.find((item) => matchPath(routePath(item), pathname)) ?? NAV[0];
  const streaming = STATUS.streaming === 'online';

  useEffect(() => {
    document.title = `${current.label} · Aether`;
  }, [current]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <UserContext.Provider value={user}>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <div className="shell">
        <aside className="sidebar card">
          <Link to="/overview" className="brand" aria-label="Aether home">
            <Mark />
            <Wordmark />
          </Link>

          <nav className="nav" aria-label="Workspace">
            <p className="label">Workspace</p>
            <ul>
              {NAV.map((item) => (
                <li key={item.id}>
                  <NavLink to={`/${item.id}`} className="nav-link">
                    <span className="nav-tile"><Icon name={item.icon} /></span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <Link to="/live" className={`stream-card inset${streaming ? '' : ' is-off'}`}>
            <span className="label"><span className="dot" />{streaming ? 'Phone streaming' : 'Phone offline'}</span>
            <span className="stream-card-text">Watch what the phone sees</span>
            <span className="btn btn-sm">Open live camera</span>
          </Link>

          <div className="sidebar-foot">
            <Link to="/profile" className="foot-profile" aria-label={`Your profile: ${user.name}`}>
              <Avatar />
              <span className="foot-who">
                <span className="foot-name">{user.name}</span>
                <span className="foot-email" title={user.email}>{user.email}</span>
              </span>
            </Link>
            {AUTH_ENABLED && (
              <button type="button" className="foot-logout" onClick={onLogout} aria-label="Log out" title="Log out">
                <Icon name="logout" size={17} />
              </button>
            )}
          </div>
        </aside>

        <main ref={mainRef} className="main" tabIndex={-1}>
          {/* SOS alerts show above every page until a caregiver presses "I'm on it". */}
          {AUTH_ENABLED && <SosAlerts />}
          <Routes>
            {NAV.map(({ id, path, Page }) => (
              <Route key={id} path={path ?? id} element={
                <Page key={pathname} user={user} authEnabled={AUTH_ENABLED} onUserChange={onUserChange} onLogout={onLogout}
                  theme={theme} onThemeChange={onThemeChange} />
              } />
            ))}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </UserContext.Provider>
  );
}
