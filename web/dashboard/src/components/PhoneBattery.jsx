// Member 2: the phone's battery, as the phone last reported it during a session (refreshed every 15 seconds).
// Shows nothing until the phone has reported, and nothing once the report is too old (session ended).
import { useEffect, useState } from 'react';
import { safetyClient } from '../services/safetyClient.js';

const CHECK_EVERY_MS = 15000;

export default function PhoneBattery() {
  const [device, setDevice] = useState(null);

  useEffect(() => {
    let alive = true;
    const check = () => safetyClient.device().then((value) => { if (alive) setDevice(value); }).catch(() => {});
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!device) return null;
  const low = !device.charging && device.battery <= 20;
  const tone = device.charging ? 'pill-ok' : low ? (device.battery <= 10 ? 'pill-danger' : 'pill-warn') : '';
  return (
    <span className={`pill ${tone}`} role="status" aria-label={`Phone battery ${device.battery} percent${device.charging ? ', charging' : ''}`}>
      <span className="battery-icon" aria-hidden="true"><span style={{ width: `${Math.max(6, device.battery)}%` }} /></span>
      {device.battery}%{device.charging ? ' · charging' : ''}
    </span>
  );
}
