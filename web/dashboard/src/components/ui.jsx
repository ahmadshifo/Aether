// Member 2: shared dashboard pieces: icons, the stand-in camera scene, page header, avatar, status labels and UTC time formatting.
import { createContext, useContext } from 'react';

const ICON_PATHS = {
  // Sidebar icons from the Option B design.
  home: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />,
  video: <path d="M4 6h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm13 4 5-3v10l-5-3" />,
  image: <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm16 12-5-5L5 21M9 9h.01" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  // Controls.
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  refresh: <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />,
  alert: (<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  key: (<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3" /></>),
};

export function Icon({ name, size = 18, strokeWidth = '1.8', ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {ICON_PATHS[name]}
    </svg>
  );
}

// Stand-in camera frame (door, exit, hallway or chair) until Member 3's JPEGs are wired in. Flat fills only.
export function SceneArt({ scene = 'hallway', sign = '', blur = false, label }) {
  return (
    <span className={`scene${blur ? ' scene-blur' : ''}`} role={label ? 'img' : undefined} aria-label={label}
      aria-hidden={label ? undefined : 'true'} style={{ display: 'block' }}>
      <span className="scene-inner">
        <span className="s-floor" />
        <span className="s-wall-l" />
        <span className="s-wall-r" />
        {scene === 'door' && (
          <span className="s-door">
            {sign && <span className="s-sign" style={{ display: 'block' }}>{sign}</span>}
            <span className="s-knob" />
          </span>
        )}
        {scene === 'exit' && (<><span className="s-exit">EXIT →</span><span className="s-exit-door" /></>)}
        {scene === 'hallway' && (<><span className="s-hall-end" /><span className="s-hall-light" /></>)}
        {scene === 'chair' && (
          <>
            <span className="s-chair-back" />
            <span className="s-chair-seat" />
            <span className="s-chair-leg" style={{ left: '40%' }} />
            <span className="s-chair-leg" style={{ left: '57%' }} />
          </>
        )}
      </span>
    </span>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <span className="label">{eyebrow}</span>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

// The signed-in user ({ user_id, email, name, created_at }), provided by App.
export const UserContext = createContext(null);

// Two initials: "Team preview" → "TP".
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase() || '?';

export function Avatar({ name, large = false }) {
  const user = useContext(UserContext);
  return <span className={`avatar${large ? ' avatar-lg' : ''}`} aria-hidden="true">{initials(name ?? user?.name)}</span>;
}

export const STATUS_LABELS = { online: 'Online', connecting: 'Connecting', offline: 'Offline', error: 'Error' };
export const STATUS_PILL = { online: 'pill-ok', connecting: 'pill-warn', offline: 'pill-danger', error: 'pill-danger' };

// A service status (ServiceStatus enum) as a pill; the word is always shown, never colour alone.
export function StatusPill({ status }) {
  return <span className={`pill ${STATUS_PILL[status]}`}><span className="dot" />{STATUS_LABELS[status]}</span>;
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
export const formatDate = (iso) => dateFormat.format(new Date(iso));

// Short label for a frame, e.g. "ROOM 205", "CHAIR".
export function frameTitle(frame) {
  if (frame.ocr_text) return frame.ocr_text.toUpperCase();
  const object = frame.objects.find((name) => name !== 'hallway') ?? frame.objects[0] ?? 'scene';
  return object.toUpperCase();
}

// What the stand-in door sign shows: the frame's text, kept short enough to fit.
export const signText = (ocr) => (ocr && ocr.length <= 12 ? ocr : '');
