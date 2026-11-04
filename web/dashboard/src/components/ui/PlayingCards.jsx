// Member 2: Playing Cards: up to 7 frames fanned as a hand; the selected card lifts 34 px. Arrow keys move the selection.
import { useLayoutEffect, useRef, useState } from 'react';

const CARD_WIDTH = 168;
const SPREAD = 92;

export default function PlayingCards({ items, selectedId, onSelect, getId, getLabel, renderCard, label }) {
  const handRef = useRef(null);
  const buttons = useRef(new Map());
  const [spread, setSpread] = useState(SPREAD);
  const mid = (items.length - 1) / 2;

  // The full 92 px spread where the hand fits; a tighter fan on narrower screens.
  useLayoutEffect(() => {
    const hand = handRef.current;
    if (!hand) return undefined;
    const fit = () => {
      const room = (hand.clientWidth - CARD_WIDTH - 24) / Math.max(1, items.length - 1);
      setSpread(Math.max(36, Math.min(SPREAD, room)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(hand);
    return () => observer.disconnect();
  }, [items.length]);

  const onKeyDown = (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step || !items.length) return;
    event.preventDefault();
    const at = Math.max(0, items.findIndex((item) => getId(item) === selectedId));
    const next = getId(items[(at + step + items.length) % items.length]);
    onSelect(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div ref={handRef} className="hand" role="group" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        const id = getId(item);
        const on = id === selectedId;
        const offset = i - mid;
        const transform = `translateX(${offset * spread}px) translateY(${Math.abs(offset) * 8 + (on ? -34 : 0)}px) rotate(${offset * 6}deg)`;
        return (
          <button key={id} ref={(node) => (node ? buttons.current.set(id, node) : buttons.current.delete(id))}
            type="button" className="playing-card" aria-pressed={on} aria-label={getLabel(item)}
            style={{ transform, zIndex: on ? 50 : 10 + i }} onClick={() => onSelect(id)}>
            {renderCard(item)}
          </button>
        );
      })}
    </div>
  );
}
