import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties } from 'react'

export function TactileButton({ height = 64, haptics = false, className = '', children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { height?: 64 | 92; haptics?: boolean }) {
  return <button type="button" {...props} className={`tactile-button ${className}`} style={{ '--action-height': `${height}px`, ...props.style } as CSSProperties}
    onClick={event => { if (haptics) { try { navigator.vibrate?.(15) } catch { /* optional browser capability */ } } onClick?.(event) }}>{children}</button>
}

export function DynamicButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const element = label.current!
    const measure = () => setWidth(Math.ceil(element.getBoundingClientRect().width) + 34)
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [])
  return <button type="button" {...props} className={`dynamic-button ${className}`} style={{ width, ...props.style }}><span ref={label}>{children}</span></button>
}

// Pointer release is the only timed commit. Native activation opens a non-timed dialog.
export function HoldToConfirm({ label, holdingLabel, releaseLabel, optionsLabel, onConfirm, onOptions, disabled = false, soft = false, haptics = false }: {
  label: string; holdingLabel: string; releaseLabel: string; optionsLabel: string
  onConfirm: () => void; onOptions: () => void; disabled?: boolean; soft?: boolean; haptics?: boolean
}) {
  const button = useRef<HTMLButtonElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const hold = useRef<{ id: number; start: number; armed: boolean } | null>(null)
  const frame = useRef(0)
  const suppress = useRef(false)
  const [stage, setStage] = useState<'idle' | 'holding' | 'armed'>('idle')
  function cancel() {
    if (hold.current) suppress.current = true
    hold.current = null; cancelAnimationFrame(frame.current)
    if (fill.current) fill.current.style.transform = 'scaleX(0)'
    setStage('idle')
  }
  useEffect(() => {
    const abort = () => cancel()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('blur', abort); document.addEventListener('visibilitychange', abort); window.addEventListener('keydown', escape)
    return () => { hold.current = null; cancelAnimationFrame(frame.current); window.removeEventListener('blur', abort); document.removeEventListener('visibilitychange', abort); window.removeEventListener('keydown', escape) }
  }, [])
  function inside(x: number, y: number) {
    const r = button.current!.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  return <div className={`hold-group ${soft ? 'soft' : ''}`}>
    <button ref={button} type="button" className="hold-button" disabled={disabled} aria-label={label}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || disabled) return
        suppress.current = false
        hold.current = { id: event.pointerId, start: performance.now(), armed: false }
        event.currentTarget.setPointerCapture(event.pointerId); setStage('holding')
        const tick = () => {
          const current = hold.current; if (!current) return
          const progress = Math.min(1, (performance.now() - current.start) / 1000)
          if (fill.current) fill.current.style.transform = `scaleX(${progress})`
          if (progress >= 1 && !current.armed) {
            current.armed = true; setStage('armed')
            if (haptics) { try { navigator.vibrate?.(60) } catch { /* optional */ } }
          }
          if (!current.armed) frame.current = requestAnimationFrame(tick)
        }
        frame.current = requestAnimationFrame(tick)
      }}
      onPointerMove={event => { if (hold.current && !inside(event.clientX, event.clientY)) cancel() }}
      onPointerLeave={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerUp={event => {
        const current = hold.current
        if (!current || current.id !== event.pointerId) return
        const elapsed = performance.now() - current.start
        const valid = inside(event.clientX, event.clientY)
        const commit = elapsed >= 1000 && valid
        cancel(); suppress.current = true
        if (commit) onConfirm()
        else if (valid && elapsed < 250) onOptions()
      }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { suppress.current = false; if (event.repeat) event.preventDefault() } }}
      onClick={event => { if (suppress.current && event.detail !== 0) { suppress.current = false; return } suppress.current = false; onOptions() }}>
      <span ref={fill} className="hold-fill" aria-hidden="true" />
      <span className="hold-label" aria-hidden="true">{stage === 'armed' ? releaseLabel : stage === 'holding' ? holdingLabel : label}</span>
      <span className="sr-only" role="status">{stage === 'armed' ? releaseLabel : ''}</span>
    </button>
    <button type="button" className="hold-options text-button" disabled={disabled} onClick={onOptions}>{optionsLabel}</button>
  </div>
}
