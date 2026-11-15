import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import { HistoryLocationSource } from '../src/platform/historyLocation';
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => ({})) }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), hasServicesEnabledAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), reverseGeocodeAsync: jest.fn() }));
const permission = jest.mocked(Location.getForegroundPermissionsAsync), position = jest.mocked(Location.getCurrentPositionAsync), geocode = jest.mocked(Location.reverseGeocodeAsync);
const signal = () => new AbortController().signal;
const fix = () => ({ timestamp: Date.now(), coords: { latitude: 33.87, longitude: 35.5, accuracy: 50 } }) as Location.LocationObject;
const source = () => new HistoryLocationSource(() => true, () => true);
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(requireOptionalNativeModule).mockReturnValue({} as never);
  permission.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as never);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  position.mockImplementation(async () => fix());
  geocode.mockResolvedValue([{ city: 'Beirut', district: 'Chiyah' }] as never);
});
afterEach(() => jest.useRealTimers());

test('permission is requested once at session start, never during a question or after denial', async () => {
  permission.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true } as never);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
  const src = source(); await src.prepare(); expect(src.getSnapshot()).toBe('permission');
  permission.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true } as never);
  await src.prepare(); await expect(src.capture(signal())).resolves.toBeUndefined();
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1); expect(position).not.toHaveBeenCalled();
});
test('moving requests a fresh fix and leaves the previous tag unchanged', async () => {
  const src = source(), first = await src.capture(signal());
  geocode.mockResolvedValueOnce([{ city: 'Beirut', district: 'Baabda' }] as never);
  const second = await src.capture(signal());
  expect(first?.label).toBe('Beirut, Chiyah'); expect(second?.label).toBe('Beirut, Baabda');
  expect(position).toHaveBeenCalledTimes(2); expect(Object.keys(second!)).toEqual(['label', 'captured_at']);
});
test('disabled, locked and old native builds avoid location access', async () => {
  for (const src of [new HistoryLocationSource(() => false, () => true), new HistoryLocationSource(() => true, () => false)]) {
    await src.prepare(); await expect(src.capture(signal())).resolves.toBeUndefined();
  }
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  const src = source(); await src.prepare(); await expect(src.capture(signal())).resolves.toBeUndefined();
  expect(src.getSnapshot()).toBe('unavailable'); expect(permission).not.toHaveBeenCalled();
});
test('disabled services, stale or inaccurate fixes and empty geocoding omit the area', async () => {
  const src = source(); jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValueOnce(false);
  await expect(src.capture(signal())).resolves.toBeUndefined(); expect(src.getSnapshot()).toBe('servicesOff');
  for (const value of [{ ...fix(), timestamp: Date.now() - 60000 }, { ...fix(), coords: { ...fix().coords, accuracy: 5000 } }]) {
    position.mockResolvedValueOnce(value); await expect(src.capture(signal())).resolves.toBeUndefined();
  }
  expect(geocode).not.toHaveBeenCalled(); geocode.mockResolvedValueOnce([]);
  await expect(src.capture(signal())).resolves.toBeUndefined(); expect(src.getSnapshot()).toBe('unresolved');
});
test('abort stops waiting immediately and never geocodes a late fix', async () => {
  let finish!: (value: Location.LocationObject) => void;
  position.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const src = source(), controller = new AbortController(), pending = src.capture(controller.signal);
  await Promise.resolve(); await Promise.resolve(); controller.abort(); await expect(pending).resolves.toBeUndefined();
  finish(fix()); await Promise.resolve(); expect(geocode).not.toHaveBeenCalled();
});
test('six second deadline lets an answer continue even if native GPS never resolves', async () => {
  jest.useFakeTimers(); position.mockImplementationOnce(() => new Promise(() => {}));
  const src = source(), pending = src.capture(signal()); await jest.advanceTimersByTimeAsync(6000);
  await expect(pending).resolves.toBeUndefined(); expect(src.getSnapshot()).toBe('unresolved');
});
test('turning the setting off then on invalidates a pending geocode', async () => {
  let finish!: (value: Location.LocationGeocodedAddress[]) => void;
  geocode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const src = source(), pending = src.capture(signal());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  src.cancel(); finish([{ city: 'Private old area' }] as never);
  await expect(pending).resolves.toBeUndefined();
});
