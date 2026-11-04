// Member 2: saved frames fanned as playing cards, searchable by caption, read text and objects (data from Member 3's API).
import { useMemo, useState } from 'react';
import { PlayingCards, Segmented } from '../components/ui/index.js';
import { Icon, PageHeader, SceneArt, formatDate, formatTime, signText } from '../components/ui.jsx';
import { FRAMES, sceneFor } from '../data/mockData.js';

// Same windows as the search modes in api-v1.yaml.
const RANGES = [
  { value: 'latest', label: 'Latest', seconds: 10 },
  { value: 'recent', label: 'Last 2 min', seconds: 120 },
  { value: 'history', label: 'Whole session', seconds: Infinity },
];
const HAND_SIZE = 7;
const blurry = (frame) => /blur/i.test(frame.caption);

// Every word must appear in the caption, the read text or the objects.
function matches(frame, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [frame.caption, frame.ocr_text, ...frame.objects].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function Card({ frame }) {
  return (
    <>
      <span className="card-corner"><span>{formatTime(frame.captured_at)}</span><span>{frame.ocr_text ? 'TXT' : 'OBJ'}</span></span>
      <span className="card-art"><SceneArt scene={sceneFor(frame)} sign={signText(frame.ocr_text)} blur={blurry(frame)} /></span>
      <span className="card-caption">{frame.caption}</span>
    </>
  );
}

export default function VisualMemory({ param }) {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('history');
  const [selectedId, setSelectedId] = useState(param ?? FRAMES[0].frame_id);

  const results = useMemo(() => {
    const newest = Math.max(...FRAMES.map((frame) => Date.parse(frame.captured_at)));
    const { seconds } = RANGES.find((option) => option.value === range);
    return FRAMES.filter((frame) => newest - Date.parse(frame.captured_at) <= seconds * 1000)
      .filter((frame) => matches(frame, query));
  }, [query, range]);

  const selected = results.find((frame) => frame.frame_id === selectedId) ?? results[0];
  // Up to 7 cards in the hand, kept around the selected frame.
  const at = Math.max(0, results.indexOf(selected));
  const start = Math.min(Math.max(0, at - Math.floor(HAND_SIZE / 2)), Math.max(0, results.length - HAND_SIZE));
  const hand = results.slice(start, start + HAND_SIZE);
  const step = (direction) => {
    if (!results.length) return;
    setSelectedId(results[(at + direction + results.length) % results.length].frame_id);
  };
  const count = results.length > HAND_SIZE
    ? `Showing ${HAND_SIZE} of ${results.length}`
    : `${results.length} of ${FRAMES.length} frames`;

  return (
    <>
      <PageHeader eyebrow="Memory / Saved frames" title="Visual memory" subtitle="Thumb through the scenes the camera kept." />

      <div className="card search-bar" role="search">
        <Icon name="search" />
        <label htmlFor="memory-search" className="sr-only">Search saved frames</label>
        <input id="memory-search" className="search-input" type="search" value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search scenes, objects or sign text — try “door” or “exit”" />
        <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
      </div>

      <section className="card section section-tight" aria-labelledby="hand-title">
        <div className="card-head">
          <div>
            <h2 id="hand-title" className="card-title">Saved moments</h2>
            <span className="label" aria-live="polite">{count}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-icon" aria-label="Previous frame" onClick={() => step(-1)} disabled={!results.length}>
              <Icon name="left" size={16} strokeWidth="2" />
            </button>
            <button type="button" className="btn btn-icon" aria-label="Next frame" onClick={() => step(1)} disabled={!results.length}>
              <Icon name="right" size={16} strokeWidth="2" />
            </button>
          </div>
        </div>
        {results.length === 0 ? (
          <p className="empty">Nothing in memory matches “{query}”.</p>
        ) : (
          <PlayingCards items={hand} selectedId={selected.frame_id} onSelect={setSelectedId} label="Saved frames"
            getId={(frame) => frame.frame_id} getLabel={(frame) => `Frame ${formatTime(frame.captured_at)}: ${frame.caption}`}
            renderCard={(frame) => <Card frame={frame} />} />
        )}
      </section>

      {selected && (
        <section className="card frame-detail" aria-labelledby="frame-title">
          <span className="frame-detail-stage">
            <SceneArt scene={sceneFor(selected)} sign={signText(selected.ocr_text)} blur={blurry(selected)} label={selected.caption} />
          </span>
          <div className="frame-detail-body">
            <span className="label">Selected frame · {formatTime(selected.captured_at)}</span>
            <h2 id="frame-title" className="card-title">{selected.caption}</h2>
            <span className="label">Text recognized</span>
            {selected.ocr_text
              ? <span className="chip-ink">{selected.ocr_text}</span>
              : <p className="muted">No text found in this frame.</p>}
            <span className="label">Detected objects</span>
            <ul className="chips">
              {selected.objects.map((object) => <li key={object} className="chip">{object}</li>)}
            </ul>
            <span className="label frame-detail-foot">{formatDate(selected.captured_at)} · deleted after 24 h</span>
          </div>
        </section>
      )}
    </>
  );
}
