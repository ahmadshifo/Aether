import { useEffect, useSyncExternalStore } from 'react'
import { indexedHistoryStorage, LocalHistoryRepository, RETENTION_MS } from './historyRepository'
let repository: LocalHistoryRepository | undefined
export function getHistoryRepository() {
  if (!repository) {
    let storage: Storage | undefined
    try { storage = localStorage } catch { /* private/blocked storage */ }
    repository = new LocalHistoryRepository(indexedHistoryStorage(), storage)
  }
  return repository
}
export function useHistory() {
  const repo = getHistoryRepository()
  const snapshot = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  useEffect(() => {
    const expiry = Math.min(...snapshot.items.filter(item => item.createdAt).map(item => Date.parse(item.createdAt!) + RETENTION_MS))
    const timer = Number.isFinite(expiry) ? window.setTimeout(() => repo.expire(), Math.max(0, expiry - Date.now())) : undefined
    const foreground = () => { if (document.visibilityState === 'visible') repo.expire() }
    document.addEventListener('visibilitychange', foreground)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', foreground) }
  }, [repo, snapshot.items])
  return { ...snapshot, repository: repo }
}
