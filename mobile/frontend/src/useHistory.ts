import { useEffect, useSyncExternalStore } from 'react'
import { indexedHistoryStorage, LocalHistoryRepository, RETENTION_MS } from './historyRepository'
import type { HistoryOwner } from './historyRepository'
export function createHistoryRepository(owner: HistoryOwner) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* private/blocked storage */ }
  return new LocalHistoryRepository(indexedHistoryStorage(owner), storage, owner)
}
export function useHistory(repo: LocalHistoryRepository) {
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
