// Local endpoint detection: no upload while waiting silently for a question.
// This is an energy gate, not a speech model; real-room sensitivity needs device QA.
export class UtteranceGate {
  private voiced = 0;
  private lastVoice = 0;
  private speech = false;
  sample(elapsed: number, db?: number): 'wait' | 'send' | 'silence' | 'unavailable' {
    if (db === undefined || !Number.isFinite(db)) return elapsed > 2000 ? 'unavailable' : 'wait';
    if (db > -42) { this.voiced++; this.lastVoice = elapsed; if (this.voiced >= 3) this.speech = true; }
    else this.voiced = 0;
    if (elapsed >= 28000) return this.speech ? 'send' : 'silence';
    if (this.speech && elapsed - this.lastVoice >= 1400) return 'send';
    if (!this.speech && elapsed >= 8000) return 'silence';
    return 'wait';
  }
}
