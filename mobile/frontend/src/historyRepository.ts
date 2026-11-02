import type { HistoryItem, Language } from './voiceSession'

export type LocalHistoryItem = HistoryItem & {
  createdAt?: string
  capturedAt?: string
  photo?: Blob
  sample?: boolean
}
export type HistorySnapshot = { items: LocalHistoryItem[]; loading: boolean; error: boolean }
type StoredHistory = { revision: number; items: LocalHistoryItem[] }
// Future server adapter boundary. No endpoint, server IDs or network calls belong here.
export interface HistoryStorage { read(): Promise<StoredHistory | null>; write(value: StoredHistory): Promise<void> }
export const LEGACY_KEY = 'echosight-local-history-v1'
export const TEXT_KEY = 'echosight-local-history-v2'
export const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_PHOTO_BYTES = 1_500_000
const MAX_TOTAL_BYTES = 20_000_000

export function validItems(value: unknown): LocalHistoryItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.filter((item): item is LocalHistoryItem => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || typeof item.question !== 'string'
      || typeof item.answer !== 'string' || (item.language !== 'en' && item.language !== 'ar')) return false
    seen.add(item.id)
    return true
  }).map(item => ({ ...item, time: typeof item.time === 'string' ? item.time : '',
    createdAt: typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined,
    photo: item.photo instanceof Blob ? item.photo : undefined,
  }))
}

export function boundItems(items: LocalHistoryItem[], now = Date.now()): LocalHistoryItem[] {
  let bytes = 0
  return validItems(items).filter(item => !item.createdAt || now - Date.parse(item.createdAt) < RETENTION_MS)
    .slice(0, 50).map(item => {
      if (!item.photo) return item
      bytes += item.photo.size
      return item.photo.size > MAX_PHOTO_BYTES || bytes > MAX_TOTAL_BYTES ? { ...item, photo: undefined, capturedAt: undefined } : item
    })
}

export function indexedHistoryStorage(): HistoryStorage {
  let connection: Promise<IDBDatabase> | undefined
  function db() {
    return connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('echosight-history', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('history')
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('History storage blocked'))
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    })
  }
  return {
    async read() {
      const database = await db()
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('history', 'readonly')
        const request = transaction.objectStore('history').get('current')
        transaction.oncomplete = () => resolve(request.result ?? null)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    },
    async write(value) {
      const database = await db()
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('history', 'readwrite')
        // One atomic snapshot owns its Blobs; removing a record cannot orphan a photo.
        transaction.objectStore('history').put(value, 'current')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    },
  }
}

export class LocalHistoryRepository {
  private snapshot: HistorySnapshot
  private listeners = new Set<() => void>()
  private journal: ((items: LocalHistoryItem[]) => LocalHistoryItem[])[] = []
  private revision = 0
  private queue = Promise.resolve()
  private writeScheduled = false
  private storage: HistoryStorage
  private text: Pick<Storage, 'getItem' | 'setItem'> | undefined
  readonly ready: Promise<void>

  constructor(storage: HistoryStorage, text?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storage = storage
    this.text = text
    let initial: LocalHistoryItem[] = []
    let fallback: StoredHistory | null = null
    let failed = false
    try {
      fallback = JSON.parse(text?.getItem(TEXT_KEY) ?? 'null') as StoredHistory | null
      initial = validItems(fallback?.items ?? JSON.parse(text?.getItem(LEGACY_KEY) ?? '[]'))
      this.revision = typeof fallback?.revision === 'number' ? fallback.revision : 0
    } catch { failed = true }
    this.snapshot = { items: boundItems(initial), loading: true, error: failed }
    this.ready = this.hydrate(fallback)
  }
  getSnapshot = () => this.snapshot
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  private publish(items: LocalHistoryItem[], loading = this.snapshot.loading, error = this.snapshot.error) {
    this.snapshot = { items, loading, error }
    this.listeners.forEach(callback => callback())
  }
  private async hydrate(fallback: StoredHistory | null) {
    let items = this.snapshot.items
    let failed = this.snapshot.error
    try {
      const stored = await this.storage.read()
      if (stored && stored.revision >= (fallback?.revision ?? 0)) {
        items = validItems(stored.items)
        this.revision = stored.revision
      } else if (stored && fallback) {
        // Newer text fallback includes deletions/clear, so never resurrect old DB records.
        const photos = new Map(validItems(stored.items).map(item => [item.id, item]))
        items = validItems(fallback.items).map(item => ({ ...item,
          photo: item.capturedAt === photos.get(item.id)?.capturedAt ? photos.get(item.id)?.photo : undefined,
        }))
      }
    } catch { failed = true }
    for (const operation of this.journal) items = operation(items)
    this.journal = []
    this.publish(boundItems(items), false, failed)
    this.schedulePersist()
  }
  private schedulePersist() {
    if (this.writeScheduled) return
    this.writeScheduled = true
    queueMicrotask(() => {
      this.writeScheduled = false
      this.persist()
    })
  }
  private persist() {
    const value = { revision: this.revision = Math.max(Date.now(), this.revision + 1), items: this.snapshot.items }
    const textItems = value.items.map(({ photo: _photo, ...item }) => item)
    let textFailed = false
    try {
      if (!this.text) throw new Error('Text storage unavailable')
      this.text.setItem(TEXT_KEY, JSON.stringify({ ...value, items: textItems }))
      this.text.setItem(LEGACY_KEY, JSON.stringify(textItems))
    } catch { textFailed = true }
    this.queue = this.queue.then(async () => {
      try { await this.storage.write(value) }
      catch {
        // Retry without image payloads. Answers and speech never wait for persistence.
        try { await this.storage.write({ ...value, items: textItems }) } catch { /* text fallback or memory */ }
        if (value.revision === this.revision) this.publish(this.snapshot.items, false, true)
        return
      }
      if (value.revision === this.revision) this.publish(this.snapshot.items, false, textFailed)
    })
  }
  private mutate(operation: (items: LocalHistoryItem[]) => LocalHistoryItem[]) {
    if (this.snapshot.loading) this.journal.push(operation)
    this.publish(boundItems(operation(this.snapshot.items)))
    if (!this.snapshot.loading) this.schedulePersist()
  }
  list() { return this.snapshot.items }
  upsert(item: LocalHistoryItem) { this.mutate(items => [item, ...items.filter(row => row.id !== item.id)]) }
  remove(id: string) { this.mutate(items => items.filter(item => item.id !== id)) }
  restore(item: LocalHistoryItem, index: number, beforeId?: string, afterId?: string) {
    this.mutate(items => {
      const next = items.filter(row => row.id !== item.id)
      const anchor = beforeId ? next.findIndex(row => row.id === beforeId) : -1
      const previous = afterId ? next.findIndex(row => row.id === afterId) : -1
      const position = anchor >= 0 ? anchor : previous >= 0 ? previous + 1
        : !beforeId && !afterId ? next.length : Math.min(index, next.length)
      next.splice(position, 0, item)
      return next
    })
  }
  clear() { this.mutate(() => []) }
  expire() {
    if (boundItems(this.snapshot.items).length !== this.snapshot.items.length) this.mutate(items => items)
  }
  async settled() { await this.ready; await this.queue }
}

export function dateGroup(item: LocalHistoryItem, now = new Date()): 'today' | 'yesterday' | 'earlier' {
  if (!item.createdAt) return 'earlier' // Never parse a localized legacy label.
  const date = new Date(item.createdAt)
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay(date, now) ? 'today' : sameDay(date, yesterday) ? 'yesterday' : 'earlier'
}
export function itemTime(item: LocalHistoryItem, language: Language) {
  return item.createdAt ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(item.createdAt)) : item.time
}
export function searchHistory(items: LocalHistoryItem[], query: string) {
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()
  const needle = normalize(query)
  return items.filter(item => normalize(`${item.question} ${item.answer}`).includes(needle))
}
