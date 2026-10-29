import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import EchoIcon from './EchoIcon'
import type { HistoryItem, Language } from './voiceSession'

type Props = { language: Language; onBack: () => void; items: HistoryItem[] }

// UI placeholders only. Member 2's /api/v1/questions replaces these later.
const samples: Record<Language, HistoryItem[]> = {
  en: [
    { id: '1', language: 'en', question: 'What was written on the door?', answer: 'The sign on the door reads Room 205.', time: 'Sample conversation 1' },
    { id: '2', language: 'en', question: 'What is in front of me?', answer: 'There is a chair in front of you.', time: 'Sample conversation 2' },
  ],
  ar: [
    { id: '1', language: 'ar', question: 'ماذا كُتب على الباب؟', answer: 'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.', time: 'محادثة تجريبية ١' },
    { id: '2', language: 'ar', question: 'ماذا يوجد أمامي؟', answer: 'يوجد كرسي أمامك.', time: 'محادثة تجريبية ٢' },
  ],
}

export default function HistoryPage({ language, onBack, items }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const isArabic = language === 'ar'
  const copy = isArabic
    ? { title: 'سجل المحادثات', subtitle: 'الأسئلة والإجابات السابقة', detail: 'تفاصيل الإجابة', question: 'السؤال', answer: 'الإجابة', back: 'عودة إلى السجل', close: 'إغلاق السجل', sample: items.length ? 'تم حفظ المحادثات على هذا الجهاز فقط.' : 'بيانات تجريبية — سيتم ربط السجل بالخادم لاحقاً.', expand: 'عرض التفاصيل' }
    : { title: 'Conversation history', subtitle: 'Past questions and answers', detail: 'Answer details', question: 'QUESTION', answer: 'ANSWER', back: 'Back to history', close: 'Close history', sample: items.length ? 'Conversations saved on this device only.' : 'Sample history — server integration comes later.', expand: 'View details' }

  const visible = items.length ? items : samples[language]
  const selected = visible.find((item) => item.id === selectedId)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (selectedId) setSelectedId(null)
        else onBack()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
      previouslyFocused?.focus()
    }
  }, [onBack, selectedId])

  function handleDialogKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="sheet-layer" dir={isArabic ? 'rtl' : 'ltr'}>
      <button type="button" className="sheet-scrim" onClick={onBack} aria-label={copy.close} tabIndex={-1} />
      <section
        ref={dialogRef}
        className="history-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-heading"
        onKeyDown={handleDialogKeys}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-header">
          <div className="sheet-heading-group">
            <p className="eyebrow">ECHOSIGHT</p>
            <h2 id="history-heading">{selected ? copy.detail : copy.title}</h2>
            {!selected && <p className="sheet-subtitle">{copy.subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-control sheet-close" onClick={onBack} aria-label={copy.close}>
            <EchoIcon name="close" />
          </button>
        </header>
        <div className="sheet-scroll">
          {selected ? (
            <>
              <button className="history-back" type="button" onClick={() => setSelectedId(null)}>
                <EchoIcon name={isArabic ? 'arrow-right' : 'arrow-left'} size={18} />
                {copy.back}
              </button>
              <div className="history-detail">
                <p className="eyebrow">{selected.time}</p>
                <p className="history-field-label">{copy.question}</p>
                <p className="history-full-question">{selected.question}</p>
                <div className="history-rule" />
                <p className="history-field-label">{copy.answer}</p>
                <p className="history-full-answer">{selected.answer}</p>
              </div>
            </>
          ) : (
            <div className="history-items">
              {visible.map((item) => (
                <button key={item.id} className="history-item" type="button" onClick={() => setSelectedId(item.id)} aria-label={`${copy.expand}: ${item.question}`}>
                  <span className="history-item-icon"><EchoIcon name="history" size={20} /></span>
                  <span className="history-item-content">
                    <span className="history-item-date">{item.time}</span>
                    <span className="history-item-question">{item.question}</span>
                    <span className="history-item-answer">{item.answer}</span>
                  </span>
                  <EchoIcon name={isArabic ? 'arrow-left' : 'arrow-right'} size={18} className="history-chevron" />
                </button>
              ))}
            </div>
          )}
          <p className="history-disclaimer">{copy.sample}</p>
        </div>
      </section>
    </div>
  )
}
