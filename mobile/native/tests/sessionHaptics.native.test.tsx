import { Vibration } from 'react-native';
import { sessionHaptics } from '../src/platform/sessionHaptics';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('two full pulses finish before session startup continues', async () => {
  let complete = false;
  const pending = sessionHaptics(true).then(() => { complete = true; });
  expect(Vibration.vibrate).toHaveBeenCalledWith(400);
  await jest.advanceTimersByTimeAsync(519);
  expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
  expect(complete).toBe(false);
  await jest.advanceTimersByTimeAsync(400);
  await pending;
  expect(complete).toBe(true);
});

test('Stop cancels feedback immediately and prevents the second pulse', async () => {
  const request = new AbortController();
  const pending = sessionHaptics(true, request.signal);
  await jest.advanceTimersByTimeAsync(100);
  request.abort(); await pending;
  expect(Vibration.cancel).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(2000);
  expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
});

test('disabled or cancelled feedback never vibrates; unsupported hardware does not block Start', async () => {
  const request = new AbortController(); request.abort();
  await sessionHaptics(false);
  await sessionHaptics(true, request.signal);
  expect(Vibration.vibrate).not.toHaveBeenCalled();
  jest.mocked(Vibration.vibrate).mockImplementationOnce(() => { throw Error('unavailable'); });
  await expect(sessionHaptics(true)).resolves.toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
});
