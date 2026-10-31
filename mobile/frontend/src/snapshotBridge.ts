import type { HistoryItem, Language } from './voiceSession'
import type { LocalHistoryItem } from './historyRepository'

// Normal questions are single-in-flight: handleQuestion stops input before getFrame,
// then emits onAnswer before speaking/returnToListening. pause() does NOT advance the
// controller generation. After any pause we conservatively disable photos until the
// next start/language generation, since a capture awaiting toBlob can outlive pause.
export class SnapshotBridge {
  private generation = 0
  private enabled = false
  private pending: { generation: number; session: string; question: string; language: Language; capturedAt: string; photo?: Blob } | null = null
  reset() { this.generation++; this.enabled = true; this.pending = null }
  cancel() { this.generation++; this.enabled = false; this.pending = null }
  discard() { this.pending = null }
  async capture(capture: () => Promise<Blob | null>, session: string, question: string, language: Language) {
    const token = { generation: this.generation, session, question, language, capturedAt: new Date().toISOString(), photo: undefined as Blob | undefined }
    this.pending = this.enabled ? token : null
    const blob = await capture() // Return the SAME Blob, without changing the capture algorithm.
    if (this.enabled && this.pending === token && token.generation === this.generation && blob && blob.size <= 1_500_000) token.photo = blob
    return blob
  }
  consume(item: HistoryItem, session: string): LocalHistoryItem {
    const pending = this.pending
    this.pending = null
    const matches = this.enabled && pending?.generation === this.generation && pending.session === session
      && pending.question === item.question && pending.language === item.language && pending.photo
    return { ...item, createdAt: new Date().toISOString(), ...(matches ? { photo: pending.photo, capturedAt: pending.capturedAt } : {}) }
  }
}
