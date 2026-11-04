// Member 2: Dynamic Button: its width animates to the measured label (Connect → Connecting… → Connected ✓).
import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

// state: 'idle' | 'busy' | 'done'; labels: { idle, busy, done }.
export default function DynamicButton({ state = 'idle', labels, onClick, disabled = false, type = 'button' }) {
  const innerRef = useRef(null);
  const [width, setWidth] = useState(null);
  const label = labels[state];
  const measure = () => {
    if (innerRef.current) setWidth(Math.ceil(innerRef.current.getBoundingClientRect().width) + 2);
  };

  // Measure before paint when the label changes, so the width animation starts at once.
  useLayoutEffect(measure, [label, state]);

  // Measure again when the content resizes on its own (the web font finishing loading).
  useLayoutEffect(() => {
    if (!innerRef.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(innerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <button type={type} className={`dynamic${state === 'done' ? ' is-done' : ''}`} style={width ? { width } : undefined}
      onClick={onClick} disabled={disabled} aria-busy={state === 'busy'}>
      <span ref={innerRef} className="dynamic-inner">
        {state === 'done' && <Icon name="check" size={16} strokeWidth="2.4" />}
        <span aria-live="polite">{label}</span>
      </span>
    </button>
  );
}
