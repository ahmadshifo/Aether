import { requireOptionalNativeModule } from 'expo';
import type { HistoryLocation } from '../shared/types';
import { areaLabel } from '../storage/historyLocation';

type LocationModule = typeof import('expo-location');
export type LocationStatus = 'idle' | 'ready' | 'permission' | 'servicesOff' | 'unavailable' | 'unresolved';
const load = (): LocationModule | undefined => {
  if (!requireOptionalNativeModule('ExpoLocation')) return;
  try { return require('expo-location') as LocationModule; } catch { return; }
};

export class HistoryLocationSource {
  private status: LocationStatus = 'idle';
  private listeners = new Set<() => void>();
  private generation = 0;
  cancel = () => { this.generation++; };
  constructor(private allowed: () => boolean, private enabled: () => boolean) {}
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(status: LocationStatus) {
    if (!this.allowed() || !this.enabled()) return;
    this.status = status; this.listeners.forEach(listener => listener());
  }
  async prepare(signal?: AbortSignal) {
    if (!this.allowed() || !this.enabled() || signal?.aborted) return;
    const location = load();
    if (!location) { this.set('unavailable'); return; }
    try {
      let permission = await location.getForegroundPermissionsAsync();
      if (!this.allowed() || !this.enabled() || signal?.aborted) return;
      if (permission.status === 'undetermined' && permission.canAskAgain) permission = await location.requestForegroundPermissionsAsync();
      if (!signal?.aborted) this.set(permission.granted ? 'ready' : 'permission');
    } catch { if (!signal?.aborted) this.set('unresolved'); }
  }
  capture(signal: AbortSignal): Promise<HistoryLocation | undefined> {
    if (!this.allowed() || !this.enabled() || signal.aborted) return Promise.resolve(undefined);
    const generation = this.generation;
    const location = load();
    if (!location) { this.set('unavailable'); return Promise.resolve(undefined); }
    return new Promise(resolve => {
      let finished = false;
      const valid = () => !finished && generation === this.generation && !signal.aborted && this.allowed() && this.enabled();
      const finish = (value?: HistoryLocation) => {
        if (finished) return;
        const keep = valid(); finished = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        resolve(keep ? value : undefined);
      };
      const abort = () => finish();
      const timer = setTimeout(() => { if (valid()) this.set('unresolved'); finish(); }, 6000);
      signal.addEventListener('abort', abort, { once: true });
      void (async () => {
        const permission = await location.getForegroundPermissionsAsync();
        if (!valid()) return;
        if (!permission.granted) { this.set('permission'); return; }
        if (!(await location.hasServicesEnabledAsync())) { if (valid()) this.set('servicesOff'); return; }
        if (!valid()) return;
        // A fresh fix for this question; never reuse another question's area after moving.
        const position = await location.getCurrentPositionAsync({ accuracy: location.Accuracy.Balanced });
        if (!valid()) return;
        const age = Date.now() - position.timestamp, { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(age) || age < -60000 || age > 30000 || !Number.isFinite(latitude) || !Number.isFinite(longitude)
          || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy == null || accuracy < 0 || accuracy > 2000) {
          this.set('unresolved'); return;
        }
        const addresses = await location.reverseGeocodeAsync({ latitude, longitude });
        if (!valid()) return;
        const label = addresses[0] ? areaLabel(addresses[0]) : '';
        if (!label) { this.set('unresolved'); return; }
        this.set('ready');
        return { label, captured_at: new Date(position.timestamp).toISOString() };
      })().then(finish, () => { if (valid()) this.set('unresolved'); finish(); });
    });
  }
}
