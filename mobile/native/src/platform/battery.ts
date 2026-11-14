// The phone's battery level for the session's spoken warnings.
// It talks to expo-battery's native part directly instead of importing the package: the package's own code
// requires the native part as soon as it loads, which crashes an app built before expo-battery was added
// (in development Metro reports it as a crash even inside try/catch). Without the native part, battery
// warnings are simply skipped.
import { requireOptionalNativeModule } from 'expo';

type Subscription = { remove(): void };
type NativeBattery = {
  getBatteryLevelAsync?(): Promise<number>;
  getBatteryStateAsync?(): Promise<number>;
  addListener?(event: string, listener: (event: { batteryLevel?: number; batteryState?: number }) => void): Subscription;
};

// expo-battery's BatteryState values: 0 unknown, 1 unplugged, 2 charging, 3 full.
const CHARGING = 2, FULL = 3;

/** The battery right now ("what's my battery?"), or null when this build can't read it. */
export async function readBattery(): Promise<{ level: number; charging: boolean } | null> {
  const battery = requireOptionalNativeModule<NativeBattery>('ExpoBattery');
  if (!battery?.getBatteryLevelAsync || !battery.getBatteryStateAsync) return null;
  try {
    const [level, state] = await Promise.all([battery.getBatteryLevelAsync(), battery.getBatteryStateAsync()]);
    return { level, charging: state === CHARGING || state === FULL };
  } catch {
    return null;
  }
}

/**
 * Calls `listener(level 0..1, charging)` now and whenever the level or charging changes.
 * Returns a function that stops watching.
 */
export function watchBattery(listener: (level: number, charging: boolean) => void): () => void {
  const battery = requireOptionalNativeModule<NativeBattery>('ExpoBattery');
  if (!battery?.addListener || !battery.getBatteryLevelAsync || !battery.getBatteryStateAsync) return () => {};
  let level = -1, charging = false, stopped = false;
  const charge = (state: number | undefined) => state === CHARGING || state === FULL;
  const report = () => { if (!stopped) listener(level, charging); };
  const subscriptions: Subscription[] = [];
  try {
    subscriptions.push(battery.addListener('Expo.batteryLevelDidChange', event => {
      if (typeof event.batteryLevel === 'number') { level = event.batteryLevel; report(); }
    }));
    subscriptions.push(battery.addListener('Expo.batteryStateDidChange', event => { charging = charge(event.batteryState); report(); }));
    void Promise.all([battery.getBatteryLevelAsync(), battery.getBatteryStateAsync()])
      .then(([value, state]) => { level = value; charging = charge(state); report(); })
      .catch(() => {});
  } catch { /* The native part refused: no battery warnings this session. */ }
  return () => { stopped = true; subscriptions.forEach(subscription => { try { subscription.remove(); } catch { /* Already removed. */ } }); };
}
