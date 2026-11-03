// Member 2: Logo Trace Loader: the mark's outline draws itself in 800 ms, then fills and opens its eyes in 150 ms.
// runKey: 0 = shown filled; each new value replays the trace once. loop = keep tracing (while connecting).
export default function LogoTraceLoader({ size = 28, runKey = 0, loop = false, strokeWidth = 1.8 }) {
  const mode = loop ? ' is-loop' : runKey ? ' is-running' : '';
  return (
    <svg key={runKey} className={`trace${mode}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path className="trace-outline" pathLength="100" strokeWidth={strokeWidth}
        d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
      <path className="trace-eyes" d="M10 9v5M14 9v5" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
