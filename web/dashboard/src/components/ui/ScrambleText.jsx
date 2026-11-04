// Member 2: Scramble Text: random characters decode into the real text from left to right.
// Screen readers only ever get the final text, through a hidden aria-live span.
import { useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion.js';

const CHARSETS = { text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%', hex: '0123456789abcdef' };
const KEEP = new Set([' ', '-', '/']);

// step = characters revealed per tick (0.4 for read text, 1.2 for IDs); keepPrefix = leading characters never scrambled.
export function useScramble(target, { runKey = 0, charset = 'text', step = 0.4, tick = 45, keepPrefix = 0 } = {}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (reduced || !target) {
      setShown(target);
      return undefined;
    }
    const chars = CHARSETS[charset];
    let revealed = keepPrefix;
    const draw = () => target.split('')
      .map((ch, i) => (KEEP.has(ch) || i < revealed ? ch : chars[Math.floor(Math.random() * chars.length)]))
      .join('');
    setShown(draw());
    const timer = window.setInterval(() => {
      revealed += step;
      if (revealed >= target.length) {
        window.clearInterval(timer);
        setShown(target);
      } else {
        setShown(draw());
      }
    }, tick);
    return () => window.clearInterval(timer);
  }, [target, runKey, charset, step, tick, keepPrefix, reduced]);

  return { shown, settled: shown === target };
}

export default function ScrambleText({ text, className = '', ...options }) {
  const { shown } = useScramble(text, options);
  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only" aria-live="polite">{text}</span>
    </span>
  );
}
