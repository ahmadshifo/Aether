import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import EchoIcon from './EchoIcon'

export default function Modal({ title, closeLabel, onClose, children, className = '' }: {
  title: string; closeLabel: string; onClose: () => void; children: ReactNode; className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current!
    dialog.showModal() // Native top layer: focus containment, Escape, background inertness.
    dialog.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      dialog.close()
      if (previous?.isConnected && previous !== document.body) previous.focus()
      else document.querySelector<HTMLElement>('#history-heading')?.focus()
    }
  }, [])
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={id}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      // Keep keyboard focus in the topmost dialog, including browsers that let
      // Tab leave a native dialog for browser chrome and fire window focus again.
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'))
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="modal-header"><h2 id={id}>{title}</h2>
      <button className="icon-control" aria-label={closeLabel} onClick={onClose}><EchoIcon name="close" /></button>
    </header>
    <div className="modal-body">{children}</div>
  </dialog>
}
