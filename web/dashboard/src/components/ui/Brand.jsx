// Member 2: the Aether brand: a black square with two white rounded eyes, and the Pirata One wordmark.
export function Mark({ size = 40 }) {
  return <span className={`mark mark-${size}`} aria-hidden="true"><span /><span /></span>;
}

export function Wordmark() {
  return <span className="wordmark">Aether</span>;
}
