// Member 2: Hold to Confirm: a soft red bar fills over a 1 s hold (pointer, or Space/Enter held), then offers Undo for 5 s.
import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 1000;
const UNDO_SECONDS = 5;

// onCommit runs once the Undo window has passed without Undo: do the irreversible work there.
export default function HoldToConfirm({ label, doneLabel, finalLabel, undoMessage, onConfirm, onUndo, onCommit, disabled = false }) {
  const [phase, setPhase] = useState('idle'); // idle | holding | undo | done
  const [progress, setProgress] = useState(0);
  const [left, setLeft] = useState(UNDO_SECONDS);
  const frame = useRef(0);
  const startedAt = useRef(0);
  const holding = useRef(false);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Undo countdown, one second at a time.
  useEffect(() => {
    if (phase !== 'undo') return undefined;
    if (left <= 0) {
      setPhase('done');
      onCommit?.();
      return undefined;
    }
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, left]);

  const tick = (now) => {
    const done = Math.min(100, ((now - startedAt.current) / HOLD_MS) * 100);
    setProgress(done);
    if (done < 100) {
      frame.current = requestAnimationFrame(tick);
      return;
    }
    holding.current = false;
    setLeft(UNDO_SECONDS);
    setPhase('undo');
    onConfirm?.();
  };

  const begin = () => {
    if (disabled || phase !== 'idle' || holding.current) return;
    holding.current = true;
    setPhase('holding');
    startedAt.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (!holding.current) return;
    holding.current = false;
    cancelAnimationFrame(frame.current);
    setPhase('idle');
    setProgress(0);
  };
  const undo = () => {
    setPhase('idle');
    setProgress(0);
    onUndo?.();
  };

  const isKey = (event) => event.key === ' ' || event.key === 'Enter';
  const text = { idle: label, holding: 'Keep holding…', undo: doneLabel, done: finalLabel }[phase];

  return (
    <>
      <button type="button" className="hold" aria-disabled={disabled || phase === 'undo' || phase === 'done'}
        aria-label={phase === 'idle' || phase === 'holding' ? `${label}. Press and hold for one second.` : text}
        onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
        onKeyDown={(event) => { if (isKey(event)) { event.preventDefault(); if (!event.repeat) begin(); } }}
        onKeyUp={(event) => { if (isKey(event)) cancel(); }}
        onBlur={cancel} onContextMenu={(event) => event.preventDefault()}>
        <span className={`hold-fill${phase === 'idle' ? ' is-resetting' : ''}`} aria-hidden="true"
          style={{ width: `${phase === 'undo' || phase === 'done' ? 100 : progress}%` }} />
        <span className="hold-label">{text}</span>
      </button>
      {phase === 'undo' && (
        <div className="undo-row inset" role="status">
          <span>{undoMessage(left)}</span>
          <button type="button" className="btn" onClick={undo}>Undo</button>
        </div>
      )}
    </>
  );
}
