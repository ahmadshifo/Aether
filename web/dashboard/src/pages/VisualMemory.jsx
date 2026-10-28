// Member 2: searchable timeline of saved frames with OCR text, object labels and frame details (data from Member 3's API).
import { useMemo, useState } from 'react';
import { Avatar, Icon, PageHeader, SceneArt, formatDateTime, formatTime, signNumber } from '../components/ui.jsx';
import { FRAMES, sceneFor } from '../data/mockData.js';

// Same windows as the search modes in api-v1.yaml.
const RANGES = [
  { value: 'latest', label: 'Latest', seconds: 10 },
  { value: 'recent', label: 'Last 2 minutes', seconds: 120 },
  { value: 'history', label: 'Whole session', seconds: Infinity },
];
const PAGE_SIZE = 3;

function matches(frame, query) {
  if (!query) return true;
  const haystack = [frame.caption, frame.ocr_text, ...frame.objects].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function exportLog(frames) {
  const blob = new Blob([JSON.stringify({ frames }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: 'visual-memory-log.json' });
  link.click();
  URL.revokeObjectURL(url);
}

function FrameDetails({ frame }) {
  if (!frame) {
    return (
      <aside className="card details">
        <p className="label">Selected frame</p>
        <p className="muted-sm">Pick a saved moment to see what was recognised.</p>
      </aside>
    );
  }
  return (
    <aside className="card details" aria-labelledby="details-title">
      <p className="label label-first">Selected frame</p>
      <h2 id="details-title" className="card-title">Frame details</h2>
      <div className="details-stage">
        <SceneArt scene={sceneFor(frame)} sign={signNumber(frame.ocr_text)} label={frame.caption} />
      </div>

      <p className="label">Scene summary</p>
      <p className="qa-answer">{frame.caption}.</p>

      <p className="label">Text recognized</p>
      {frame.ocr_text
        ? <span className="chip chip-ocr"><Icon name="file" size={14} />{frame.ocr_text}</span>
        : <p className="muted-sm">No text found in this frame.</p>}

      <p className="label">Detected objects</p>
      <ul className="chips">
        {frame.objects.map((object) => <li key={object} className="chip">{object}</li>)}
      </ul>

      <p className="muted-sm with-icon details-time">
        <Icon name="clock" size={14} />
        <time dateTime={frame.captured_at}>{formatDateTime(frame.captured_at)}</time>
      </p>
    </aside>
  );
}

export default function VisualMemory({ param }) {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('recent');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState(param ?? FRAMES[0].frame_id);

  const results = useMemo(() => {
    const newest = Math.max(...FRAMES.map((frame) => Date.parse(frame.captured_at)));
    const { seconds } = RANGES.find((option) => option.value === range);
    return FRAMES.filter((frame) => newest - Date.parse(frame.captured_at) <= seconds * 1000)
      .filter((frame) => matches(frame, query.trim()));
  }, [query, range]);

  const shown = results.slice(0, visible);
  const selected = results.find((frame) => frame.frame_id === selectedId) ?? results[0];

  return (
    <>
      <PageHeader
        eyebrow="Memory / Saved frames"
        title="Visual memory"
        subtitle="Search the scenes the camera has seen."
        actions={(
          <>
            <button type="button" className="btn" onClick={() => exportLog(results)}>
              <Icon name="file" size={16} />Export log
            </button>
            <Avatar />
          </>
        )}
      />

      <div className="card search-bar" role="search">
        <Icon name="search" size={18} className="search-icon" />
        <label htmlFor="memory-search" className="sr-only">Search saved frames</label>
        <input id="memory-search" type="search" placeholder="Search scenes, objects, or sign text…"
          value={query} onChange={(event) => { setQuery(event.target.value); setVisible(PAGE_SIZE); }} />
        <div className="select-wrap">
          <Icon name="filter" size={15} />
          <label htmlFor="memory-range" className="sr-only">Time range</label>
          <select id="memory-range" value={range}
            onChange={(event) => { setRange(event.target.value); setVisible(PAGE_SIZE); }}>
            {RANGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div className="memory-grid">
        <section className="card" aria-labelledby="moments-title">
          <div className="card-head">
            <h2 id="moments-title" className="card-title">Saved moments</h2>
            <span className="muted-sm" aria-live="polite">
              {results.length === FRAMES.length
                ? `${FRAMES.length} frames in this session`
                : `${results.length} of ${FRAMES.length} frames`}
            </span>
          </div>

          {results.length === 0 ? (
            <p className="empty-state">Nothing in memory matches “{query}”.</p>
          ) : (
            <ul className="moments">
              {shown.map((frame) => {
                const isSelected = frame.frame_id === selected?.frame_id;
                return (
                  <li key={frame.frame_id}>
                    <button type="button" className="moment" aria-pressed={isSelected}
                      onClick={() => setSelectedId(frame.frame_id)}>
                      <span className="moment-stage">
                        <SceneArt scene={sceneFor(frame)} sign={signNumber(frame.ocr_text)} />
                      </span>
                      {isSelected && <span className="moment-check"><Icon name="check" size={14} /></span>}
                      <span className="moment-body">
                        <span className="moment-title">{frame.caption}</span>
                        <span className="moment-meta">
                          {formatTime(frame.captured_at)} · {frame.ocr_text ? 'OCR detected' : 'Objects detected'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {visible < results.length && (
                <li>
                  <button type="button" className="moment more-tile" onClick={() => setVisible((n) => n + PAGE_SIZE + 1)}>
                    <Icon name="image" size={24} />
                    <span className="moment-title">More frames</span>
                    <span className="moment-meta with-icon">Load next page<Icon name="arrow" size={13} /></span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>

        <FrameDetails frame={selected} />
      </div>
    </>
  );
}
