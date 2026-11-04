// Member 2: Selector: a button that opens a listbox (arrows move, Enter picks, Escape closes); opens with a 150 ms fade and slide.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

export default function Selector({ label, labelledBy, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    listRef.current?.focus();
    const onOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (index) => {
    onChange(options[index].value);
    close();
  };

  const onButtonKey = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };
  const onListKey = (event) => {
    const last = options.length - 1;
    const moves = {
      ArrowDown: (a) => (a + 1) % options.length,
      ArrowUp: (a) => (a - 1 + options.length) % options.length,
      Home: () => 0,
      End: () => last,
    };
    if (moves[event.key]) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="selector" ref={rootRef}>
      <button ref={buttonRef} type="button" className="selector-button" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={listId} aria-labelledby={labelledBy ? `${labelledBy} ${listId}-current` : undefined}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onButtonKey}>
        <span id={`${listId}-current`}>
          <span className="option-label">{current.label}</span>
          <span className="option-desc">{current.description}</span>
        </span>
        <Icon name="chevron" size={16} strokeWidth="2" />
      </button>
      <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={label}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={`selector-list${open ? ' is-open' : ''}`} onKeyDown={onListKey}>
        {options.map((option, index) => (
          <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
            className={`selector-option${open && index === active ? ' is-active' : ''}`}
            onClick={() => choose(index)} onPointerMove={() => setActive(index)}>
            <span>
              <span className="option-label">{option.label}</span>
              <span className="option-desc">{option.description}</span>
            </span>
            {option.value === value && <Icon name="check" size={16} strokeWidth="2.4" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
