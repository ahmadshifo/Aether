// Member 2: Scroll Fade List: a scrolling list whose top and bottom fade out through a transparency mask.
export default function ScrollFadeList({ label, children }) {
  return <ul className="scroll-fade" aria-label={label}>{children}</ul>;
}
