// Member 2: the red SOS banner shown at the top of every dashboard page.
// It checks for new SOS alerts every few seconds. An unanswered alert stays on screen, beeps, and shows the
// frames the camera saw, until someone presses "I'm on it" (which stops it on every dashboard of this account).
import { useCallback, useEffect, useRef, useState } from 'react';
import { safetyClient } from '../services/safetyClient.js';
import { Icon, formatTime } from './ui.jsx';

const CHECK_EVERY_MS = 5000;
const BEEP_EVERY_MS = 2500;

// A short two-tone alarm made in the browser (no sound file). Browsers only allow sound after the page has
// been clicked once, so before that the banner is silent but still visible.
function beep(context) {
  if (!context || context.state !== 'running') return;
  const now = context.currentTime;
  [880, 660].forEach((frequency, i) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.25 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + i * 0.25);
    oscillator.stop(now + i * 0.25 + 0.24);
  });
}

export default function SosAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [busy, setBusy] = useState(null);
  const audio = useRef(null);
  const open = alerts.filter((alert) => !alert.acknowledged_at);

  const check = useCallback(async () => {
    try { setAlerts(await safetyClient.alerts()); } catch { /* backend unreachable: keep the last known alerts */ }
  }, []);

  // Look for new alerts now and every few seconds.
  useEffect(() => {
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  // Prepare sound on the first click anywhere (browser rule), then beep while an alert is unanswered.
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new (window.AudioContext || window.webkitAudioContext)();
        audio.current.resume();
      } catch { /* no sound support: the banner still shows */ }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
  useEffect(() => {
    if (!open.length) return undefined;
    beep(audio.current);
    const timer = window.setInterval(() => beep(audio.current), BEEP_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [open.length]);

  async function acknowledge(alertId) {
    setBusy(alertId);
    try { await safetyClient.acknowledge(alertId); await check(); } finally { setBusy(null); }
  }

  if (!open.length) return null;
  return (
    <section className="sos-banner" role="alert" aria-live="assertive" aria-label="SOS alerts">
      {open.map((alert) => (
        <div key={alert.alert_id} className="sos-alert">
          <div className="sos-text">
            <strong><Icon name="alert" size={18} /> SOS: the user asked for help</strong>
            <span>At {formatTime(alert.created_at)}. The phone is calling the emergency number saved on the Profile page.</span>
          </div>
          {alert.evidence_frame_ids.length > 0 && (
            <ul className="sos-frames" aria-label="What the camera saw">
              {alert.evidence_frame_ids.map((id) => (
                <li key={id}><img src={`/api/v1/frames/${id}/image`} alt="Camera frame from the moment of the SOS (faces blurred)" /></li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-primary" onClick={() => acknowledge(alert.alert_id)} disabled={busy === alert.alert_id}>
            {busy === alert.alert_id ? 'Saving…' : "I'm on it"}
          </button>
        </div>
      ))}
    </section>
  );
}
