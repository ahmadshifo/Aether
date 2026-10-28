// Member 2: reads the current MediaMTX WebRTC/WHEP stream from Member 1's server; shows a mock scene until WHEP is wired in.
import { Icon, SceneArt } from './ui.jsx';

export default function LiveStream({ stream, large = false, detection }) {
  return (
    <section className={`card live-card${large ? ' live-card-large' : ''}`} aria-labelledby="live-title">
      <div className="card-head">
        <div>
          <h2 id="live-title" className="card-title">Live camera feed</h2>
          <p className="card-sub">Session 001 · {stream.device}</p>
        </div>
        <span className="pill pill-live"><span className="dot dot-online pulse" aria-hidden="true" />LIVE</span>
      </div>

      <div className="live-stage">
        <SceneArt scene="door" sign="205" label="Mock camera view: a corridor with a door labelled Room 205" />
        {detection && (
          <div className="detection" aria-hidden="true">
            <span className="detection-tag"><span>{detection.label}</span><strong>{detection.value}</strong></span>
          </div>
        )}
      </div>

      <div className="live-foot">
        <span className="with-icon"><Icon name="video" size={14} />WebRTC stream</span>
        <span>720p · {stream.fps} fps</span>
        {large
          ? <span>{stream.codec}</span>
          : <a href="#/live" className="link-quiet with-icon"><Icon name="external" size={14} />Expand</a>}
      </div>
    </section>
  );
}
