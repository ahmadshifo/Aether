// Member 2: problems with the live camera (dark, frozen, no pictures, phone disconnected, memory service down).
// As a banner (every page): each alert shows until it is fixed or a caregiver presses "Seen"; a new problem shows
// again. As a list (System status page, `list`): every current problem, including the ones marked seen.
// The backend works the alerts out live, so they disappear by themselves once the problem is gone.
import { useCallback, useEffect, useState } from 'react';
import { safetyClient } from '../services/safetyClient.js';
import { Icon, formatTime } from './ui.jsx';

const CHECK_EVERY_MS = 5000;
const SEEN_KEY = 'aether.seenAlerts';

function readSeen() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}

export default function LiveAlerts({ list = false }) {
  const [alerts, setAlerts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [seen, setSeen] = useState(readSeen);

  const check = useCallback(async () => {
    try { setAlerts(await safetyClient.liveAlerts()); setLoaded(true); } catch { /* backend unreachable: keep the last known */ }
  }, []);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  function markSeen(alertId) {
    const next = new Set(seen).add(alertId);
    setSeen(next);
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...next])); } catch { /* private mode: only this page view */ }
  }

  if (list) {
    if (!loaded) return null;
    if (!alerts.length) return <p className="sub">No problems right now.</p>;
    return (
      <ul className="live-alert-list">
        {alerts.map((alert) => (
          <li key={alert.alert_id} className={`live-alert live-alert-${alert.level}`}>
            <div className="live-alert-text">
              <strong><Icon name="alert" size={16} /> {alert.title}</strong>
              <span>{alert.detail} Since {formatTime(alert.since)}.</span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const shown = alerts.filter((alert) => !seen.has(alert.alert_id));
  if (!shown.length) return null;
  return (
    <section className="live-alert-banner" role="status" aria-live="polite" aria-label="Camera alerts">
      {shown.map((alert) => (
        <div key={alert.alert_id} className={`live-alert live-alert-${alert.level}`}>
          <div className="live-alert-text">
            <strong><Icon name="alert" size={16} /> {alert.title}</strong>
            <span>{alert.detail} Since {formatTime(alert.since)}.</span>
          </div>
          <button type="button" className="btn" onClick={() => markSeen(alert.alert_id)}>Seen</button>
        </div>
      ))}
    </section>
  );
}
