export interface DepthReading { timestampMs: number; centerM?: number; nearM?: number }
export interface DepthSnapshot { timestampMs: number; centerM: number; jpeg: string }
export type DepthState = 'waiting' | 'measuring' | 'near' | 'unavailable';

export function freshReading(timestampMs: number, now = Date.now()) {
  return Number.isFinite(timestampMs) && now - timestampMs >= -200 && now - timestampMs <= 1000;
}
export function measuredMeters(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.2 && value <= 5;
}
export function validDepthSnapshot(value: DepthSnapshot | null): value is DepthSnapshot {
  return !!value && freshReading(value.timestampMs) && measuredMeters(value.centerM)
    && typeof value.jpeg === 'string' && value.jpeg.length >= 4 && value.jpeg.length <= 262144;
}

const distanceRequest = /\b(how (far|near|close)|distance (to|from|between|of)|how many (met(er|re)s?|feet|steps)|à quelle distance|a quelle distance|combien (de )?m[eè]tres?|distance (de|du|entre|jusqu)|(?:est|sont).{0,30}\b(?:loin|proche))\b|(?:كم|قديش|شقد|اديش).{0,28}(?:بعد|بعيد|قريب|متر|مساف)|(?:ما|شو|قديه).{0,12}(?:مساف|بعد|بعيد)|(?:هل|هو|هي).{0,25}(?:قريب|بعيد)/iu;
const genericRequest = /^(?:please )?(?:(?:what(?: s| is) (?:the )?|measure (?:the )?|tell me (?:the )?)distance|distance (?:ahead|please)|how (?:far|near|close)(?: (?:is it|is that|away|straight|ahead|in front of me))*|(?:quelle est la|mesure la|mesurer la) distance(?: devant moi)?|(?:شو|ما|كم|قديش)(?: هي)? المساف[ةه](?: (?:قدامي|امامي))?)(?: please)?$/u;
const proximityQuestion = /\b(?:is|are)\b.{1,64}\b(?:close|near|nearby|far away|within (?:two|2) met(?:er|re)s?)(?: (?:to |from |of )?(?:me|my phone|the camera))?$/u;
export function distanceIntent(text: string): 'center' | 'target' | undefined {
  const normalized = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[أإآ]/gu, 'ا')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // The existing history route can answer from a previous measurement; a current picture cannot.
  if (/\b(earlier|before|yesterday|ago|was|were|previously|hier|etait|etaient|auparavant)\b|(?:سابق|مبارح|امبارح|البارحة|من قبل|كان يبعد)/u.test(normalized)) return;
  if (genericRequest.test(normalized)) return 'center';
  if (/^(?:what|who) (?:is|are) (?:near|nearby|close)(?: |$)/u.test(normalized)) return;
  if (!distanceRequest.test(normalized) && !proximityQuestion.test(normalized)) return;
  const words = normalized.split(' ');
  return words.every(word => genericWords.has(word)) ? 'center' : 'target';
}

const genericWords = new Set(`what whats s is are the a an how far near close away distance measure meters metres feet steps many
to of from between it that this something object surface ahead straight front in here there me my phone please can you tell give
a quelle quel est la le l les un une de des du au aux combien metre metres distance devant moi ici ca cet cette objet il elle c loin proche mesure mesurer
كم قديش اديش شقد شو ما هي هو المسافة مسافة المسافه مسافه بيني وبين بين مني من عني قدامي امامي قريب قريبة بعيد بعيدة يبعد تبعد بعد متر امتار هذا هيدا هالشي الجسم الشيء الهاتف`.split(/\s+/u));

/** A repeated native timestamp is still the same frame. A gap invalidates a pending warning. */
export class NearbyDetector {
  private lastStamp = 0;
  private lastRange = 0;
  private nearFrames = 0;
  private farFrames = 0;
  private latched = false;
  private lastAlert = -Infinity;
  private lastHaptic = -Infinity;
  private buzzed = false;
  private delivered = false;
  private rearm() {
    this.nearFrames = this.farFrames = 0;
    this.latched = this.delivered = this.buzzed = false;
  }
  update(reading: DepthReading | null, now: number): DepthState {
    if (!reading || !freshReading(reading.timestampMs, now) || reading.timestampMs < this.lastStamp) {
      this.nearFrames = this.farFrames = 0;
      if (now - this.lastStamp > 2000) this.rearm();
      return 'waiting';
    }
    if (reading.timestampMs !== this.lastStamp) {
      if (reading.timestampMs - this.lastRange > 2000) this.rearm();
      this.lastStamp = reading.timestampMs;
      if (measuredMeters(reading.nearM)) this.lastRange = reading.timestampMs;
      const near = measuredMeters(reading.nearM) && reading.nearM < 2;
      this.nearFrames = near ? this.nearFrames + 1 : 0;
      this.farFrames = measuredMeters(reading.nearM) && reading.nearM >= 2.3 ? this.farFrames + 1 : 0;
      if (this.nearFrames >= 2) this.latched = true;
      if (this.farFrames >= 3) this.rearm();
    }
    if (this.latched && measuredMeters(reading.nearM) && reading.nearM < 2 && this.nearFrames >= 2) return 'near';
    return measuredMeters(reading.centerM) || measuredMeters(reading.nearM) ? 'measuring' : 'waiting';
  }
  takeAlert(now: number) {
    if (this.delivered || now - this.lastAlert < 3000) return false;
    this.delivered = true;
    this.lastAlert = now;
    return true;
  }
  takeHaptic(now: number) {
    if (this.buzzed || now - this.lastHaptic < 3000) return false;
    this.buzzed = true;
    this.lastHaptic = now;
    return true;
  }
}
