// Member 2: Stamp: a saved frame shown as a postage stamp (dashed perforation, white ring, slight tilt).
export default function Stamp({ href, tilt = 0, small = false, label, children, caption }) {
  return (
    <a href={href} className={`stamp${small ? ' stamp-sm' : ''}`} style={{ transform: `rotate(${tilt}deg)` }} aria-label={label}>
      <span className="stamp-art">{children}</span>
      <span className="stamp-caption">{caption}</span>
    </a>
  );
}
