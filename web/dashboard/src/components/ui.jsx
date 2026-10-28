// Member 2: shared dashboard building blocks: icons, stand-in frame illustrations, page header, status labels and UTC time formatting.
import { useId } from 'react';

const ICON_PATHS = {
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></>),
  video: (<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>),
  image: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  wifi: (<><path d="M2 8.5a15 15 0 0 1 20 0" /><path d="M5 12a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>),
  sparkle: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />,
  bell: (<><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Z" /><path d="M10 21h4" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>),
  filter: <path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5Z" />,
  file: (<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  external: (<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  alert: (<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  database: (<><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>),
};

export function Icon({ name, size = 18, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {ICON_PATHS[name]}
    </svg>
  );
}

// Stand-in corridor illustration for a frame until Member 3's JPEGs are wired in.
export function SceneArt({ scene = 'hallway', sign = '', label, className = '' }) {
  const id = useId();
  return (
    <svg className={`scene ${className}`} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c3847" /><stop offset="1" stopColor="#2c5264" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" x2="1">
          <stop offset="0" stopColor="#152d3b" /><stop offset="1" stopColor="#1f3d4c" />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" x2="1">
          <stop offset="0" stopColor="#5b8a9c" stopOpacity="0" /><stop offset="1" stopColor="#7fb0c1" stopOpacity=".32" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="#132a37" />
      <polygon points="0,0 320,0 205,52 115,52" fill="#0f2430" />
      <polygon points="0,180 320,180 205,122 115,122" fill={`url(#${id}f)`} />
      <polygon points="0,0 115,52 115,122 0,180" fill={`url(#${id}w)`} />
      <polygon points="320,0 205,52 205,122 320,180" fill="#1a3645" />
      <rect x="115" y="52" width="90" height="70" fill="#1f3e4d" />
      <g stroke="#3a6273" strokeWidth="1" opacity=".8">
        <path d="M0 0 115 52M320 0 205 52M0 180 115 122M320 180 205 122" />
        <path d="M40 162 140 122M280 162 180 122" opacity=".5" />
      </g>
      <rect x="196" y="0" width="124" height="180" fill={`url(#${id}g)`} />
      <rect x="214" y="0" width="5" height="180" fill="#2f5566" />
      <rect x="292" y="0" width="5" height="180" fill="#2f5566" />

      {scene === 'door' && (
        <g>
          <rect x="232" y="24" width="50" height="150" fill="#10252f" stroke="#4d7789" strokeWidth="2" />
          {sign && (
            <>
              <rect x="240" y="36" width="34" height="13" rx="2" fill="#e3f0f3" />
              <text x="257" y="45.8" fontSize="8.5" fontWeight="700" textAnchor="middle" fill="#0d2230"
                fontFamily="inherit">{sign}</text>
            </>
          )}
          <circle cx="241" cy="104" r="2.6" fill="#e3f0f3" />
        </g>
      )}
      {scene === 'exit' && (
        <g>
          <rect x="234" y="40" width="46" height="134" fill="#10252f" stroke="#4d7789" strokeWidth="2" />
          <rect x="236" y="14" width="42" height="17" rx="2" fill="#22c55e" />
          <text x="257" y="26.2" fontSize="9" fontWeight="800" textAnchor="middle" fill="#ecfdf5"
            fontFamily="inherit">EXIT</text>
        </g>
      )}
      {scene === 'chair' && (
        <g fill="#5a7f90">
          <rect x="146" y="84" width="30" height="27" rx="2" />
          <rect x="140" y="110" width="42" height="6" rx="1.5" fill="#6d93a4" />
          <rect x="143" y="116" width="4" height="22" />
          <rect x="175" y="116" width="4" height="22" />
        </g>
      )}
      {scene === 'hallway' && <rect x="140" y="62" width="40" height="50" fill="#2d5466" opacity=".7" />}
    </svg>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, sparkle = false }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">
          {title}
          {sparkle && <Icon name="sparkle" size={20} className="title-sparkle" />}
        </h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Avatar() {
  return <span className="avatar" role="img" aria-label="Team preview account">T</span>;
}

export const STATUS_LABELS = { online: 'Online', connecting: 'Connecting', offline: 'Offline', error: 'Error' };

export function StatusDot({ status }) {
  return <span className={`dot dot-${status}`} aria-hidden="true" />;
}

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC',
});
const shortTimeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
});
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

export const formatTime = (iso) => timeFormat.format(new Date(iso));
export const formatShortTime = (iso) => shortTimeFormat.format(new Date(iso));
export const formatDateTime = (iso) => `${dateFormat.format(new Date(iso))} · ${formatTime(iso)} UTC`;

// Short human label for a frame, e.g. "Door", "Exit sign".
export function frameLabel(frame) {
  if (frame.ocr_text === 'EXIT') return 'Exit sign';
  const object = frame.objects.find((name) => name !== 'hallway') ?? frame.objects[0] ?? 'Scene';
  return object.charAt(0).toUpperCase() + object.slice(1);
}

// Last group of digits in the OCR text, drawn on the stand-in door sign.
export const signNumber = (ocr) => ocr.match(/\d+(?!.*\d)/)?.[0] ?? '';
