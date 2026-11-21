// "Where am I?": the phone's GPS position turned into a street and area (reverse geocoding), said out loud by the
// session (placeAnswer in src/voice/basics.ts). Asked for on demand only: nothing is saved or sent to Aether.
// The "Save area in History" setting is separate (src/platform/historyLocation.ts) and does not affect this.
import { requireOptionalNativeModule } from 'expo';
import type { Place } from '../voice/basics';
import { duringPermission } from './permissions';

type LocationModule = typeof import('expo-location');
const load = (): LocationModule | undefined => {
  if (!requireOptionalNativeModule('ExpoLocation')) return;
  try { return require('expo-location') as LocationModule; } catch { return; }
};

// Control characters never reach the spoken answer.
// eslint-disable-next-line no-control-regex
const clean = (value: string | null | undefined) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';

// GPS and geocoding calls can't be cancelled; stop waiting for them when the signal aborts.
function orAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(Error('cancelled')); return; }
    const abort = () => reject(Error('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function findPlace(signal: AbortSignal): Promise<Place> {
  const location = load();
  if (!location) return { status: 'unavailable' };
  let permission = await location.getForegroundPermissionsAsync();
  // The system dialog sends the app to the background; duringPermission keeps that from stopping the session.
  if (!permission.granted && permission.canAskAgain) permission = await duringPermission(() => location.requestForegroundPermissionsAsync(), signal);
  if (!permission.granted) return { status: 'permission' };
  if (!(await location.hasServicesEnabledAsync())) return { status: 'servicesOff' };
  if (signal.aborted) return { status: 'failed' };
  // A fresh, accurate fix: an old one could name the street the user has already left.
  const position = await orAbort(location.getCurrentPositionAsync({ accuracy: location.Accuracy.High }), signal);
  if (signal.aborted) return { status: 'failed' };
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { status: 'failed' };
  const addresses = await orAbort(location.reverseGeocodeAsync({ latitude, longitude }), signal).catch(() => []);
  if (signal.aborted) return { status: 'failed' };
  const address = addresses[0];
  if (!address) return { status: 'noAddress' };
  const place = {
    street: clean(address.street), number: clean(address.streetNumber), name: clean(address.name),
    district: clean(address.district) || clean(address.subregion), city: clean(address.city) || clean(address.region),
  };
  return Object.values(place).some(Boolean) ? { status: 'found', ...place } : { status: 'noAddress' };
}
