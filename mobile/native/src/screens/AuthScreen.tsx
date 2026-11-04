import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Mark, Notice, T, useUI } from '../components/ui';
import { copies } from '../i18n/nativeCopy';
import { validateAuth } from '../auth/authClient';
import type { AuthController, AuthState } from '../auth/authController';
export function AuthScreen({ state, auth, retry, connection, help }: { state: AuthState; auth?: AuthController; retry(): void; connection(): void; help(): void }) {
  const { language } = useUI(), { a, m, n } = copies(language);
  const [mode, setMode] = useState<'landing' | 'login' | 'signup'>('landing');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [show, setShow] = useState(false), [invalid, setInvalid] = useState('');
  const pending = state.status === 'submitting', available = state.status === 'signed_out' || pending;
  const reset = () => { setPassword(''); setConfirmation(''); setShow(false); setInvalid(''); auth?.clearError(); };
  const error = available ? invalid || state.error : state.error;
  const errorText = error === 'fixture_unavailable' ? n.fixture_unavailable : a.errors[error as keyof typeof a.errors] ?? a.errors.unavailable;
  return <View style={{ gap: 24 }}>
    {mode !== 'landing' && available && <Button label={m.back} onPress={() => { reset(); setMode('landing'); }} disabled={pending} />}
    <View style={{ alignItems: mode === 'landing' && available ? 'center' : undefined, gap: 20 }}>
      <Mark size={mode === 'landing' && available ? 180 : 64} />
      <T accessibilityRole="header" variant={mode === 'landing' && available ? 'brand' : 'title'} style={mode === 'landing' && available ? { fontSize: 60 } : {}}>{available ? mode === 'landing' ? 'Aether' : mode === 'signup' ? a.signup : a.welcome : a.locked}</T>
      <T>{available ? mode === 'landing' ? m.tagline : a.intro : ''}</T>
    </View>
    {!!error && <Notice danger>{errorText}</Notice>}
    {!!state.notice && <Notice>{a[state.notice as 'created' | 'signed_out']}</Notice>}
    {available && mode === 'landing' ? <><Button primary label={a.login} onPress={() => setMode('login')} /><Button label={m.signup} onPress={() => setMode('signup')} /><T variant="small">{m.accessible}</T></>
      : available ? <View style={{ gap: 18 }}>
        {mode === 'signup' && <Field label={a.name} value={name} onChangeText={setName} autoComplete="name" textContentType="name" editable={!pending} />}
        <Field label={a.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" editable={!pending} style={{ writingDirection: 'ltr', textAlign: 'left' }} />
        <Field label={a.password} value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry={!show} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} textContentType={mode === 'signup' ? 'newPassword' : 'password'} editable={!pending} />
        {mode === 'signup' && <Field label={a.confirm} value={confirmation} onChangeText={setConfirmation} autoCapitalize="none" autoCorrect={false} secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" editable={!pending} />}
        <Button label={show ? a.hide : a.show} onPress={() => setShow(!show)} disabled={pending} selected={show} />
        <Button primary label={pending ? a.pending : mode === 'signup' ? a.signup : a.login} disabled={pending} onPress={() => {
          if (mode === 'landing') return;
          const input = { name, email, password }, problem = validateAuth(mode, input, confirmation); setInvalid(problem);
          if (problem) return; void auth?.submit(mode, input); setPassword(''); setConfirmation('');
        }} />
        {pending ? <Button label={a.cancel} onPress={() => { reset(); auth?.cancelSubmit(); }} /> : <Button label={mode === 'login' ? a.newAccount : a.existing} onPress={() => { reset(); setMode(mode === 'login' ? 'signup' : 'login'); }} />}
      </View> : <>
        {['checking', 'signing_out'].includes(state.status) ? <T accessibilityLiveRegion="polite">{state.status === 'checking' ? a.checking : a.signingOut}</T> : <>
          {state.status === 'logout_failed' && <Button label={a.retryLogout} onPress={() => { void auth?.logout(); }} />}
          <Button label={a.retry} onPress={retry} />
        </>}
      </>}
    <Button label={m.connection} onPress={connection} /><Button label={m.help} onPress={help} /><T variant="small">{a.privacy}</T>
  </View>;
}
