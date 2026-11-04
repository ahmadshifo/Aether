export function Mark({ size = 34, className = '' }: { size?: number; className?: string }) {
  return <svg className={`aether-mark ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M0 0h100v100H0z" />
    <rect x="28" y="36.5" width="13" height="27" rx="6.5" fill="white" />
    <rect x="59" y="36.5" width="13" height="27" rx="6.5" fill="white" />
  </svg>
}
export function Brand() { return <span className="brand"><Mark /><span className="wordmark" dir="ltr">Aether</span></span> }
export function LogoTraceLoader({ active, size = 26 }: { active: boolean; size?: number }) {
  return <svg className={`logo-trace ${active ? 'tracing' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path className="trace-outline" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" pathLength="100" />
    <path className="trace-eyes" d="M10 9v5 M14 9v5" strokeWidth="2" strokeLinecap="round" />
  </svg>
}
