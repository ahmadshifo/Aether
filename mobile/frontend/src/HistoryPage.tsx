import { useEffect, useRef, useState } from 'react'
import EchoIcon from './EchoIcon'
import Modal from './Modal'
import { dateGroup, itemTime, searchHistory, RETENTION_MS } from './historyRepository'
import type { LocalHistoryItem, LocalHistoryRepository } from './historyRepository'
import type { Language } from './voiceSession'
import { uiCopy } from './uiCopy'

type Props = {
  language: Language; active: boolean; onBack: () => void; items: LocalHistoryItem[]
  loading: boolean; error: boolean; repository: LocalHistoryRepository
  onReplay: (item: LocalHistoryItem) => void; sessionActive: boolean; serviceReplayUnavailable?: boolean
}
function usePhoto(photo?: Blob) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = photo ? URL.createObjectURL(photo) : ''
    // Synchronize a browser resource, including revocation on replacement/unmount.
    queueMicrotask(() => setUrl(next))
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [photo])
  return url
}
function Photo({ item, language, onZoom }: { item: LocalHistoryItem; language: Language; onZoom?: () => void }) {
  const url = usePhoto(item.photo)
  const t = uiCopy[language]
  const content = url ? <img src={url} alt={item.sample ? t.sample : t.photoAlt} />
    : <span className="photo-placeholder"><EchoIcon name="camera-off" size={28} /><span>{t.noPhoto}</span></span>
  return onZoom && url ? <button className="history-photo zoom-trigger" onClick={onZoom} aria-label={t.zoom}>{content}</button>
    : <div className="history-photo">{content}</div>
}
function Zoom({ item, language, onClose }: { item: LocalHistoryItem; language: Language; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const url = usePhoto(item.photo)
  const t = uiCopy[language]
  return <Modal title={t.zoomTitle} closeLabel={t.close} onClose={onClose} className="zoom-modal">
    <div className="zoom-controls">
      <button className="icon-control" aria-label={t.zoomOut} disabled={scale <= 1} onClick={() => setScale(s => Math.max(1, s - .5))}><EchoIcon name="minus" /></button>
      <button className="text-button" onClick={() => setScale(1)}>{t.zoomReset}</button>
      <button className="icon-control" aria-label={t.zoomIn} disabled={scale >= 3} onClick={() => setScale(s => Math.min(3, s + .5))}><EchoIcon name="plus" /></button>
      <output aria-live="polite">{new Intl.NumberFormat(language, { style: 'percent' }).format(scale)}</output>
    </div>
    <div className="zoom-viewport" tabIndex={0} aria-label={t.zoomTitle}>
      {url && <img src={url} alt={item.sample ? t.sample : t.photoAlt} style={{ width: `${scale * 100}%` }} />}
    </div>
  </Modal>
}
function HistoryCard({ item, language, onDetail, onDelete, onCopy, onReplay, replayReason }: {
  item: LocalHistoryItem; language: Language; onDetail: () => void; onDelete: () => void
  onCopy: () => void; onReplay: () => void; replayReason: string
}) {
  const t = uiCopy[language]
  const start = useRef<{ x: number; y: number } | null>(null)
  return <article className="history-card" onPointerDown={event => {
    if (event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return
    start.current = { x: event.clientX, y: event.clientY }
  }} onPointerCancel={() => { start.current = null }} onPointerUp={event => {
    const origin = start.current; start.current = null
    if (!origin) return
    const dx = (event.clientX - origin.x) * (language === 'ar' ? -1 : 1)
    if (dx < -100 && Math.abs(event.clientY - origin.y) < 32) onDelete()
  }}>
    <div className="history-card-top"><Photo item={item} language={language} />
      <div className="history-card-meta"><time dateTime={item.createdAt}>{itemTime(item, language)}</time>
        {!item.createdAt && <small>{t.unknownDate}</small>}
        {item.demo && <span className="demo-badge">{t.demo}</span>}
        {item.sample && <small>{t.sample}</small>}
      </div>
    </div>
    <div className="history-field" lang={item.language} dir={item.language === 'ar' ? 'rtl' : 'ltr'}>
      <EchoIcon name="mic" size={18} /><h3>{item.question}</h3>
    </div>
    <div className="history-field answer-field" lang={item.language} dir={item.language === 'ar' ? 'rtl' : 'ltr'}>
      <EchoIcon name="sparkles" size={18} /><p>{item.answer}</p>
    </div>
    {item.demo && item.photo && <p className="fine-print">{t.demoNote}</p>}
    <button className="read-more" onClick={onDetail} aria-label={`${t.readMore}: ${item.question}`}>{t.readMore}<EchoIcon name={language === 'ar' ? 'arrow-left' : 'arrow-right'} size={16} /></button>
    <div className="card-actions">
      <button onClick={onReplay} aria-disabled={!!replayReason}><EchoIcon name="volume" size={18} />{t.replay}</button>
      <button onClick={onCopy}><EchoIcon name="copy" size={18} />{t.copy}</button>
      <button className="danger-text" onClick={onDelete}><EchoIcon name="trash" size={18} />{t.delete}</button>
    </div>
  </article>
}

export default function HistoryPage({ language, active, onBack, items, loading, error, repository, onReplay, sessionActive, serviceReplayUnavailable = false }: Props) {
  const t = uiCopy[language]
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [menu, setMenu] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [fallback, setFallback] = useState<{ text: string; language: Language } | null>(null)
  const [undo, setUndo] = useState<{ item: LocalHistoryItem; index: number; beforeId?: string; afterId?: string } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const selected = items.find(item => item.id === selectedId)
  const visible = searchHistory(items, query)
  useEffect(() => { if (active) heading.current?.focus() }, [active])
  useEffect(() => {
    if (!undo?.item.createdAt) return
    // Ordinary Undo has no timer. Only the existing privacy retention deadline can end it.
    const timer = window.setTimeout(() => { setUndo(null); setNotice('') }, Math.max(0, Date.parse(undo.item.createdAt) + RETENTION_MS - Date.now()))
    return () => window.clearTimeout(timer)
  }, [undo])
  const replayReason = (item: LocalHistoryItem) => sessionActive ? t.replayActive : item.language !== language ? t.replayLanguage : serviceReplayUnavailable ? t.replayService : ''
  function replay(item: LocalHistoryItem) {
    const reason = replayReason(item)
    if (reason) setNotice(reason)
    else onReplay(item)
  }
  function remove(item: LocalHistoryItem) {
    const index = items.findIndex(row => row.id === item.id)
    setUndo({ item, index, beforeId: items[index + 1]?.id, afterId: items[index - 1]?.id })
    repository.remove(item.id)
    if (selectedId === item.id) { setZoom(false); setSelectedId(null) }
    setNotice(t.deleted)
  }
  function textFor(item: LocalHistoryItem) {
    const copy = uiCopy[item.language]
    return `${item.demo ? `${copy.demoNote}\n\n` : ''}${copy.question}: ${item.question}\n\n${copy.answer}: ${item.answer}\n\n${itemTime(item, language)}`
  }
  async function copy(item: LocalHistoryItem) {
    const text = textFor(item)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setNotice(t.copied)
    } catch { setFallback({ text, language: item.language }) }
  }
  async function share(item: LocalHistoryItem, includePhoto: boolean) {
    // No URL and no image by default. Construct synchronously within user activation.
    const data: ShareData = { title: 'EchoSight', text: textFor(item) }
    if (includePhoto && item.photo) {
      const file = new File([item.photo], 'echosight-snapshot.jpg', { type: item.photo.type })
      try { if (navigator.canShare?.({ files: [file] })) data.files = [file] } catch { /* text share */ }
    }
    try {
      if (!navigator.share) { setFallback({ text: data.text!, language: item.language }); return }
      await navigator.share(data)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setNotice(t.shareFailed)
      setFallback({ text: data.text!, language: item.language })
    }
  }
  return <section className="history-screen" hidden={!active} aria-labelledby="history-heading">
    <header className="history-header">
      <button className="icon-control" onClick={onBack} aria-label={t.back}><EchoIcon name={language === 'ar' ? 'arrow-right' : 'arrow-left'} /></button>
      <h1 ref={heading} id="history-heading" tabIndex={-1}>{t.history}</h1>
      <div className="history-menu" onKeyDown={event => { if (event.key === 'Escape') { setMenu(false); menuButton.current?.focus() } }}>
        <button ref={menuButton} className="icon-control" aria-label={t.more} aria-expanded={menu} onClick={() => setMenu(value => !value)}><EchoIcon name="more" /></button>
        {menu && <div className="menu-popover"><button className="danger-text" disabled={!items.length || loading} onClick={() => { setMenu(false); setClearOpen(true) }}><EchoIcon name="trash" size={18} />{t.clear}</button></div>}
      </div>
    </header>
    <p className="history-privacy">{t.local}{items.some(item => !item.createdAt) && <> {t.legacy}</>}</p>
    <div className="history-search"><EchoIcon name="search" size={20} />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t.search} placeholder={t.searchPlaceholder} />
      {query && <button className="icon-control" onClick={() => setQuery('')} aria-label={t.clearSearch}><EchoIcon name="close" size={18} /></button>}
    </div>
    {error && <p className="storage-alert" role="status">{t.storageError}</p>}
    {loading ? <div className="history-loading" role="status"><p>{t.loading}</p><div className="skeleton" /><div className="skeleton" /></div>
      : !visible.length ? <div className="history-empty"><span className="empty-eye"><EchoIcon name="eye" size={40} /></span>
        <h2>{items.length ? t.noResults : t.emptyTitle}</h2><p>{items.length ? t.noResultsHint : t.emptyBody}</p>
        <button className="text-button" onClick={items.length ? () => setQuery('') : onBack}>{items.length ? t.clearSearch : t.backStart}</button>
      </div> : <div className="history-groups">{(['today', 'yesterday', 'earlier'] as const).map(group => {
        const grouped = visible.filter(item => dateGroup(item) === group)
        return grouped.length ? <section key={group} aria-labelledby={`group-${group}`}><h2 className="group-title" id={`group-${group}`}>{t[group]} <span>{new Intl.NumberFormat(language).format(grouped.length)}</span></h2>
          <ul className="history-list">{grouped.map(item => <li key={item.id}><HistoryCard item={item} language={language} replayReason={replayReason(item)}
            onDetail={() => setSelectedId(item.id)} onDelete={() => remove(item)} onCopy={() => void copy(item)} onReplay={() => replay(item)} /></li>)}</ul>
        </section> : null
      })}</div>}
    {(notice || undo) && <div className="history-toast"><p role={selected ? undefined : 'status'}>{notice}</p>
      {undo && <button className="text-button" onClick={() => { repository.restore(undo.item, undo.index, undo.beforeId, undo.afterId); setUndo(null); setNotice(t.restored) }}>{t.undo}</button>}
      <button className="icon-control" aria-label={t.dismiss} onClick={() => { setNotice(''); setUndo(null) }}><EchoIcon name="close" size={18} /></button>
    </div>}
    {selected && active && <Modal title={t.detail} closeLabel={t.close} onClose={() => { setSelectedId(null); setZoom(false) }} className="detail-modal">
      <Photo item={selected} language={language} onZoom={() => setZoom(true)} />
      <p className="fine-print">{selected.sample ? t.sample : selected.photo ? t.photoNote : t.noPhoto}</p>
      <time className="detail-time" dateTime={selected.createdAt}>{itemTime(selected, language)}</time>
      {selected.demo && <p className="demo-note">{t.demoNote}</p>}
      <div className="detail-content" lang={selected.language} dir={selected.language === 'ar' ? 'rtl' : 'ltr'}>
        <h3>{uiCopy[selected.language].question}</h3><p className="detail-question">{selected.question}</p>
        <h3>{uiCopy[selected.language].answer}</h3><p>{selected.answer}</p>
      </div>
      <div className="detail-actions">
        <button className="text-button" aria-disabled={!!replayReason(selected)} onClick={() => replay(selected)}><EchoIcon name="volume" size={20} />{t.replay}</button>
        <button className="text-button" onClick={() => void copy(selected)}><EchoIcon name="copy" size={20} />{t.copy}</button>
        <button className="text-button" onClick={() => void share(selected, false)}><EchoIcon name="share" size={20} />{t.share}</button>
        {selected.photo && <button className="text-button" onClick={() => void share(selected, true)}>{t.sharePhoto}</button>}
        <button className="text-button danger-text" onClick={() => remove(selected)}><EchoIcon name="trash" size={20} />{t.delete}</button>
      </div>
      <p className="fine-print">{replayReason(selected)} {t.playback}</p>
      {notice && <p role="status">{notice}</p>}
    </Modal>}
    {zoom && selected && active && <Zoom item={selected} language={language} onClose={() => setZoom(false)} />}
    {clearOpen && <Modal title={t.clearTitle} closeLabel={t.close} onClose={() => setClearOpen(false)}>
      <p>{t.clearBody}</p><div className="confirmation-actions"><button className="text-button" onClick={() => setClearOpen(false)}>{t.cancel}</button>
        <button className="text-button danger-button" onClick={() => { repository.clear(); setUndo(null); setSelectedId(null); setClearOpen(false); setQuery(''); setNotice(t.cleared) }}>{t.clear}</button></div>
    </Modal>}
    {fallback && <Modal title={t.copyFallback} closeLabel={t.close} onClose={() => setFallback(null)}>
      <p>{t.copyHelp}</p><textarea className="copy-fallback" readOnly aria-label={t.copyFallback} lang={fallback.language} dir={fallback.language === 'ar' ? 'rtl' : 'ltr'} value={fallback.text} onFocus={event => event.target.select()} />
    </Modal>}
  </section>
}
