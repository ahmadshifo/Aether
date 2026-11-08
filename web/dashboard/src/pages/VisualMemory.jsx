// Member 2: saved frames fanned as playing cards, newest first, searchable by caption, read text and objects.
// Data: the signed-in account's camera sessions of the last 24 hours (AI backend), and each session's saved
// frames and images from Member 3's API. No AI describes frames yet, so their descriptions say "This is a demo".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { PlayingCards, Segmented } from '../components/ui/index.js';
import { Icon, PageHeader, formatDate, formatTime } from '../components/ui.jsx';
import { memoryClient } from '../services/memoryClient.js';
import { streamsClient } from '../services/streamsClient.js';

// Same windows as the search modes in api-v1.yaml, counted back from the newest saved frame.
const RANGES = [
  { value: 'latest', label: 'Latest', seconds: 10 },
  { value: 'recent', label: 'Last 2 min', seconds: 120 },
  { value: 'history', label: 'Whole day', seconds: Infinity },
];
const HAND_SIZE = 7;
const DEMO = 'This is a demo';
const describe = (frame) => frame.caption || DEMO;

// Every word must appear in the description, the read text or the objects.
function matches(frame, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [describe(frame), frame.ocr_text, ...frame.objects].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// Every saved frame of this account's recent sessions, newest first. A session that fails to load is skipped.
async function loadFrames() {
  const sessions = await streamsClient.recentSessions();
  const results = await Promise.allSettled(sessions.map((session) => memoryClient.frames(session.session_id)));
  const failed = results.filter((result) => result.status === 'rejected');
  if (sessions.length && failed.length === sessions.length) throw failed[0].reason;
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
}

function FrameImage({ frame, alt = '' }) {
  return (
    <img src={memoryClient.imageUrl(frame.frame_id)} alt={alt} loading="lazy" draggable={false}
      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
  );
}

function Card({ frame }) {
  return (
    <>
      <span className="card-corner"><span>{formatTime(frame.captured_at)}</span><span>{frame.ocr_text ? 'TXT' : 'IMG'}</span></span>
      <span className="card-art"><FrameImage frame={frame} /></span>
      <span className="card-caption">{describe(frame)}</span>
    </>
  );
}

export default function VisualMemory() {
  const { frameId } = useParams();
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('history');
  const [selectedId, setSelectedId] = useState(frameId ?? null);
  const [state, setState] = useState({ loading: true, error: null, frames: [] });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, frames: await loadFrames() });
    } catch (error) {
      setState({ loading: false, error: error.message, frames: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { frames } = state;
  const results = useMemo(() => {
    if (!frames.length) return [];
    const newest = Date.parse(frames[0].captured_at);
    const { seconds } = RANGES.find((option) => option.value === range);
    return frames.filter((frame) => newest - Date.parse(frame.captured_at) <= seconds * 1000)
      .filter((frame) => matches(frame, query));
  }, [frames, query, range]);

  const selected = results.find((frame) => frame.frame_id === selectedId) ?? results[0];
  // Up to 7 cards in the hand, kept around the selected frame.
  const at = Math.max(0, results.indexOf(selected));
  const start = Math.min(Math.max(0, at - Math.floor(HAND_SIZE / 2)), Math.max(0, results.length - HAND_SIZE));
  const hand = results.slice(start, start + HAND_SIZE);
  const step = (direction) => {
    if (!results.length) return;
    setSelectedId(results[(at + direction + results.length) % results.length].frame_id);
  };
  const count = state.loading ? 'Loading…'
    : results.length > HAND_SIZE ? `Showing ${HAND_SIZE} of ${results.length}` : `${results.length} of ${frames.length} frames`;

  let empty = null;
  if (state.error) {
    empty = (
      <div className="empty" role="alert">
        <p>Couldn't load your saved frames: {state.error}</p>
        <button type="button" className="btn" onClick={load}>Try again</button>
      </div>
    );
  } else if (!state.loading && !frames.length) {
    empty = <p className="empty">No saved frames yet. Frames are saved when the assistant answers a question, and now and then while your phone streams. They're deleted after 24 hours.</p>;
  } else if (!state.loading && !results.length) {
    empty = <p className="empty">Nothing in memory matches “{query}”.</p>;
  }

  return (
    <>
      <PageHeader eyebrow="Memory / Saved frames" title="Visual memory" subtitle="Thumb through the scenes the camera kept today." />

      <div className="card search-bar" role="search">
        <Icon name="search" />
        <label htmlFor="memory-search" className="sr-only">Search saved frames</label>
        <input id="memory-search" className="search-input" type="search" value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search descriptions, objects or sign text" />
        <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
      </div>

      <section className="card section section-tight" aria-labelledby="hand-title" aria-busy={state.loading}>
        <div className="card-head">
          <div>
            <h2 id="hand-title" className="card-title">Saved moments</h2>
            <span className="label" aria-live="polite">{count}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={load} disabled={state.loading}>Refresh</button>
            <button type="button" className="btn btn-icon" aria-label="Previous frame" onClick={() => step(-1)} disabled={!results.length}>
              <Icon name="left" size={16} strokeWidth="2" />
            </button>
            <button type="button" className="btn btn-icon" aria-label="Next frame" onClick={() => step(1)} disabled={!results.length}>
              <Icon name="right" size={16} strokeWidth="2" />
            </button>
          </div>
        </div>
        {empty ?? (results.length > 0 && (
          <PlayingCards items={hand} selectedId={selected.frame_id} onSelect={setSelectedId} label="Saved frames"
            getId={(frame) => frame.frame_id} getLabel={(frame) => `Frame ${formatTime(frame.captured_at)}: ${describe(frame)}`}
            renderCard={(frame) => <Card frame={frame} />} />
        ))}
      </section>

      {selected && (
        <section className="card frame-detail" aria-labelledby="frame-title">
          <span className="frame-detail-stage">
            <FrameImage frame={selected} alt={`Saved frame from ${formatTime(selected.captured_at)} (faces blurred)`} />
          </span>
          <div className="frame-detail-body">
            <span className="label">Selected frame · {formatTime(selected.captured_at)}</span>
            <h2 id="frame-title" className="card-title">{describe(selected)}</h2>
            <span className="label">Text recognized</span>
            {selected.ocr_text
              ? <span className="chip-ink">{selected.ocr_text}</span>
              : <p className="muted">{DEMO}</p>}
            <span className="label">Detected objects</span>
            {selected.objects.length
              ? <ul className="chips">{selected.objects.map((object) => <li key={object} className="chip">{object}</li>)}</ul>
              : <p className="muted">{DEMO}</p>}
            <span className="label frame-detail-foot">{formatDate(selected.captured_at)} · deleted after 24 h</span>
          </div>
        </section>
      )}
    </>
  );
}
