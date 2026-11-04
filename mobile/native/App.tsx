import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, BackHandler, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { UIContext, Notice } from './src/components/ui';
import { Frame } from './src/components/Frame';
import { AuthScreen } from './src/screens/AuthScreen';
import { Account } from './src/screens/Account';
import { HelpScreen } from './src/screens/HelpScreen';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { AuthController, type AuthState } from './src/auth/authController';
import { createAuthClient } from './src/auth/authClient';
import { boundedFetch, defaultEndpoints, validateEndpoints, type Endpoints } from './src/platform/config';
import { copies } from './src/i18n/nativeCopy';
import { dark, light } from './src/theme/tokens';
import type { Language } from './src/shared/types';
import { nativeFetch } from './src/platform/network';
const CONFIG_KEY = 'aether-native-connection-v1';
const waiting: AuthState = { status: 'checking', session: null, error: '', notice: '' };
const failed: AuthState = { status: 'service_unavailable', session: null, error: 'fixture_unavailable', notice: '' };
const noSubscription = () => () => {};
export default function App() {
  const scheme = useColorScheme();
  const [language, setLanguage] = useState<Language>('en'), [reduced, setReduced] = useState(false), [endpoints, setEndpoints] = useState(defaultEndpoints), [publicPage, setPublicPage] = useState<'auth' | 'connection' | 'help'>('auth');
  const [auth, setAuth] = useState<AuthController>(), [boot, setBoot] = useState<AuthState>(waiting);
  const current = useRef<AuthController | undefined>(undefined), connectEpoch = useRef(0), endpointRef = useRef(endpoints);
  const [fonts, fontError] = useFonts({ Inter: require('./assets/fonts/Inter-Regular.ttf'), InterSemi: require('./assets/fonts/Inter-SemiBold.ttf'), PirataOne: require('./assets/fonts/PirataOne-Regular.ttf'), JetBrainsMono: require('./assets/fonts/JetBrainsMono-Regular.ttf'), NotoSansArabic: require('./assets/fonts/NotoSansArabic-Regular.ttf') });
  const state = useSyncExternalStore(auth?.subscribe ?? noSubscription, auth?.getSnapshot ?? (() => boot));
  async function connect(value: Endpoints, fresh: boolean, persist = false) {
    const epoch = ++connectEpoch.current;
    current.current?.dispose(); current.current = undefined; setAuth(undefined); setBoot(waiting); setEndpoints(value); endpointRef.current = value;
    if (persist) await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(value)).catch(() => {});
    try {
      const health = await boundedFetch(`${value.backend}/health`, { credentials: 'omit' }, 8000, nativeFetch);
      const data = await health.json();
      if (!health.ok || data.service !== 'aether-native-fixture' || data.storage !== 'sqlite' || data.answers !== 'demo' || typeof data.environment !== 'string' || !/^[a-f\d-]{36}$/i.test(data.environment)) throw Error('fixture_unavailable');
      if (epoch !== connectEpoch.current) return;
      const next = new AuthController(createAuthClient(value.backend, nativeFetch), `${value.backend}|${data.environment}`);
      current.current = next; setAuth(next); setPublicPage('auth');
      if (fresh) next.requireFresh(); else await next.check();
    } catch { if (epoch === connectEpoch.current) setBoot(failed); }
  }
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    void AsyncStorage.getItem(CONFIG_KEY).then(raw => {
      if (!alive) return;
      if (!raw) { setBoot(failed); setPublicPage('connection'); return; }
      const config = validateEndpoints(JSON.parse(raw)); void connect(config, false);
    }).catch(() => { if (alive) { setBoot(failed); setPublicPage('connection'); } });
    let backgrounded = false;
    const appState = AppState.addEventListener('change', value => {
      if (value === 'background') { backgrounded = true; connectEpoch.current++; current.current?.background(); }
      else if (value === 'active' && backgrounded) { backgrounded = false; if (current.current) void current.current.check(); else setBoot(failed); }
    });
    return () => { alive = false; connectEpoch.current++; current.current?.dispose(); motion.remove(); appState.remove(); };
  }, []);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (publicPage !== 'auth' && state.status !== 'signed_in') { setPublicPage('auth'); return true; } return false; }); return () => sub.remove(); }, [publicPage, state.status]);
  const save = (value: Endpoints) => { setPublicPage('auth'); void connect(value, true, true); };
  const retry = () => { if (current.current) void current.current.check(); else void connect(endpointRef.current, false); };
  const ui = { language, colors: scheme === 'dark' ? dark : light, fonts, motion: !reduced, haptics: false };
  return <SafeAreaProvider><UIContext.Provider value={ui}><StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    {auth && state.status === 'signed_in' && state.session ? <Account key={`${state.session.owner.source}:${state.session.owner.epoch}`} auth={auth} session={state.session} endpoints={endpoints} saveEndpoints={save} changeLanguage={setLanguage} />
      : <Frame languageChange={setLanguage} back={publicPage !== 'auth' ? () => setPublicPage('auth') : undefined}>
        {fontError && <Notice>{copies(language).n.fontFallback}</Notice>}
        {publicPage === 'connection' ? <ConnectionScreen endpoints={endpoints} onSave={save} signedIn={false} /> : publicPage === 'help' ? <HelpScreen /> : <AuthScreen state={state} auth={auth} retry={retry} connection={() => setPublicPage('connection')} help={() => setPublicPage('help')} />}
      </Frame>}
  </UIContext.Provider></SafeAreaProvider>;
}
