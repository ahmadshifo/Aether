import { recognize } from '../src/voice/recognition';
const mockListeners = new Map<string, (...args: unknown[]) => void>();
const mockModule = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })), isRecognitionAvailable: () => true,
  getSupportedLocales: jest.fn(async () => ({ locales: ['en-US', 'fr-FR', 'ar-LB'], installedLocales: [] })),
  addListener: jest.fn((event: string, callback: (...args: unknown[]) => void) => { mockListeners.set(event, callback); return { remove: jest.fn() }; }),
  start: jest.fn(() => mockListeners.get('start')?.()), abort: jest.fn(() => mockListeners.get('end')?.()),
};
jest.mock('../src/platform/capabilities', () => ({ loadRecognition: () => mockModule }));
test('French recognition selects a French locale and releases the recognizer on cancellation', async () => {
  const request = new AbortController(), events = { start: jest.fn(), result: jest.fn(), end: jest.fn(), error: jest.fn() };
  const stop = await recognize('fr', events, request.signal);
  expect(mockModule.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'fr-FR' }));
  request.abort(); await stop(); expect(mockModule.abort).toHaveBeenCalled();
});
