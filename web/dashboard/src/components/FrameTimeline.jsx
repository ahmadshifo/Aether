// Member 2: renders timestamped image thumbnails and OCR/object metadata from Member 3's frame-list API.
import { sceneFor } from '../data/mockData.js';
import { Icon, SceneArt, formatShortTime, frameLabel, signNumber } from './ui.jsx';

export default function FrameTimeline({ frames }) {
  return (
    <section className="card timeline-card" aria-labelledby="timeline-title">
      <div className="card-head">
        <h2 id="timeline-title" className="card-title">Recent visual memory</h2>
        <a href="#/memory" className="link-accent with-icon">View timeline<Icon name="arrow" size={14} /></a>
      </div>
      <ol className="timeline-strip">
        {frames.map((frame) => (
          <li key={frame.frame_id}>
            <a href={`#/memory/${frame.frame_id}`} className="timeline-item"
              aria-label={`${frameLabel(frame)} at ${formatShortTime(frame.captured_at)}`}>
              <SceneArt scene={sceneFor(frame)} sign={signNumber(frame.ocr_text)} />
              <span className="frame-chip">
                <time dateTime={frame.captured_at}>{formatShortTime(frame.captured_at)}</time> · {frameLabel(frame)}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
