// Member 2: Tactile Button: a dark face on a thick black edge that presses down 5 px in 80 ms.
import { useState } from 'react';

export default function TactileButton({ children, type = 'button', ...rest }) {
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  const onKey = (event) => { if (event.key === ' ' || event.key === 'Enter') setPressed(true); };

  return (
    <button {...rest} type={type} className={`tactile${pressed ? ' is-pressed' : ''}`}
      onPointerDown={() => setPressed(true)} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
      onKeyDown={onKey} onKeyUp={release} onBlur={release}>
      {children}
    </button>
  );
}
