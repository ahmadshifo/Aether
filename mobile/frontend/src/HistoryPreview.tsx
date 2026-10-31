import { useEffect, useState, useSyncExternalStore } from 'react'
import HistoryPage from './HistoryPage'
import { LocalHistoryRepository } from './historyRepository'
import { historyFixtures } from './historyFixtures'
import type { Language } from './voiceSession'
import { uiCopy } from './uiCopy'
import EchoIcon from './EchoIcon'

export default function HistoryPreview() {
  const [language, setLanguage] = useState<Language>('en')
  const [repository] = useState(() => {
    const samples = historyFixtures()
    // In-memory adapter only; never reads or writes the user's store.
    return new LocalHistoryRepository({ read: async () => ({ revision: 1, items: samples }), write: async () => {} }, { getItem: () => null, setItem: () => {} })
  })
  const state = useSyncExternalStore(repository.subscribe, repository.getSnapshot)
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr' }, [language])
  const t = uiCopy[language]
  return <div className="app-shell" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="app-container">
    <header className="app-header"><strong>EchoSight</strong><div className="language-switch">
      <button className="language-option" onClick={() => setLanguage('en')}>EN</button><button className="language-option" onClick={() => setLanguage('ar')}>AR</button>
    </div></header>
    <main className="app-content"><p className="demo-note">{t.preview}</p><HistoryPage {...state} active language={language} repository={repository} sessionActive={false} onReplay={() => {}} onBack={() => location.assign('/')} /></main>
    <nav className="preview-footer"><EchoIcon name="eye" size={20} /><span>{t.preview}</span></nav>
  </div></div>
}
