import { NativeModules } from 'react-native';
import { nativeCamera } from '../src/platform/camera';

const mockTrack = { stop: jest.fn(), readyState: 'live', addEventListener: jest.fn(), removeEventListener: jest.fn() };
const mockStream = {
  getTracks: () => [mockTrack], getVideoTracks: () => [mockTrack],
  release: jest.fn(), toURL: () => 'registered-camera',
};
const mockRtc = { MediaStream: jest.fn(), mediaDevices: { getUserMedia: jest.fn() } };
const mockPermission = jest.fn();
const mockModule = { open: jest.fn(), cancelOpen: jest.fn(), read: jest.fn(), snapshot: jest.fn() };
let mockInstalled = true;
jest.mock('../src/platform/capabilities', () => ({ loadRtc: () => mockRtc }));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockInstalled ? mockModule : null }));
jest.mock('expo-camera', () => ({ Camera: { requestCameraPermissionsAsync: () => mockPermission() } }));
const descriptor = { streamId: 'registered-camera', streamReactTag: 'registered-camera', tracks: [{ id: 'rgb', kind: 'video' }] };
const depth = { timestampMs: 1234, centerM: 1.8, nearM: 1.2 };
const picture = { timestampMs: depth.timestampMs, centerM: depth.centerM, jpeg: 'jpeg' };

beforeEach(() => {
  jest.resetAllMocks();
  mockInstalled = true;
  mockRtc.MediaStream.mockImplementation(() => mockStream);
  mockRtc.mediaDevices.getUserMedia.mockResolvedValue(mockStream);
  mockPermission.mockResolvedValue({ granted: true });
  mockModule.open.mockResolvedValue(descriptor);
  mockModule.read.mockReturnValue(depth);
  mockModule.snapshot.mockResolvedValue(picture);
  NativeModules.WebRTCModule = {
    mediaStreamRemoveTrack: jest.fn(), mediaStreamTrackRelease: jest.fn(), mediaStreamRelease: jest.fn(),
  };
});

it('uses one registered stream for preview, publishing, measurements and requested pictures', async () => {
  const controller = new AbortController();
  const handle = await nativeCamera(controller.signal);
  expect(mockPermission).toHaveBeenCalledTimes(1);
  expect(mockRtc.MediaStream).toHaveBeenCalledWith(descriptor);
  expect(handle.url).toBe('registered-camera');
  expect(handle).toHaveProperty('stream', mockStream);
  expect(mockRtc.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(handle.readDepth?.()).toEqual(depth);
  expect(mockModule.snapshot).not.toHaveBeenCalled();
  expect(await handle.depthSnapshot?.()).toEqual(picture);
  expect(mockModule.read).toHaveBeenCalledWith(descriptor.streamId);
  expect(mockModule.snapshot).toHaveBeenCalledWith(descriptor.streamId);
  controller.abort();
  handle.release();
  expect(mockTrack.stop).toHaveBeenCalledTimes(1);
  expect(mockStream.release).toHaveBeenCalledTimes(1);
  expect(handle.readDepth?.()).toBeNull();
  expect(await handle.depthSnapshot?.()).toBeNull();
});

it.each(['missing', 'unsupported', 'startup failed'])('keeps camera and streaming when depth is %s', async reason => {
  if (reason === 'missing') mockInstalled = false;
  else if (reason === 'unsupported') mockModule.open.mockResolvedValue(null);
  else mockModule.open.mockRejectedValue(Error('AR unavailable'));
  const handle = await nativeCamera(new AbortController().signal);
  expect(mockRtc.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: false, video: { facingMode: 'environment', width: 1280, height: 720, frameRate: 15 },
  });
  expect(handle.readDepth).toBeUndefined();
  expect(handle.depthSnapshot).toBeUndefined();
  handle.release();
});

it('honours camera denial without opening either capture', async () => {
  mockPermission.mockResolvedValue({ granted: false });
  await expect(nativeCamera(new AbortController().signal)).rejects.toThrow('camera_denied');
  expect(mockModule.open).not.toHaveBeenCalled();
  expect(mockRtc.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it('releases a native descriptor returned after Stop without opening a fallback', async () => {
  const controller = new AbortController();
  mockModule.open.mockImplementation(async () => { controller.abort(); return descriptor; });
  await expect(nativeCamera(controller.signal)).rejects.toThrow('cancelled');
  expect(mockModule.cancelOpen).toHaveBeenCalledTimes(1);
  expect(NativeModules.WebRTCModule.mediaStreamRemoveTrack).toHaveBeenCalledWith(descriptor.streamReactTag, -1, 'rgb');
  expect(NativeModules.WebRTCModule.mediaStreamTrackRelease).toHaveBeenCalledWith('rgb');
  expect(NativeModules.WebRTCModule.mediaStreamRelease).toHaveBeenCalledWith(descriptor.streamReactTag);
  expect(mockRtc.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it('releases a regular camera obtained after cancelling a depth fallback', async () => {
  const controller = new AbortController();
  mockModule.open.mockResolvedValue(null);
  mockRtc.mediaDevices.getUserMedia.mockImplementation(async () => { controller.abort(); return mockStream; });
  await expect(nativeCamera(controller.signal)).rejects.toThrow('cancelled');
  expect(mockTrack.stop).toHaveBeenCalledTimes(1);
  expect(mockStream.release).toHaveBeenCalledTimes(1);
});

it('releases a failed wrapper before attempting the ordinary camera', async () => {
  mockRtc.MediaStream.mockImplementation(() => { throw Error('incompatible wrapper'); });
  const handle = await nativeCamera(new AbortController().signal);
  expect(NativeModules.WebRTCModule.mediaStreamRelease.mock.invocationCallOrder[0])
    .toBeLessThan(mockRtc.mediaDevices.getUserMedia.mock.invocationCallOrder[0]);
  handle.release();
});

it('drops an in-flight picture after its camera is released', async () => {
  const handle = await nativeCamera(new AbortController().signal);
  let complete!: (value: typeof picture) => void;
  mockModule.snapshot.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = handle.depthSnapshot?.();
  handle.release();
  complete(picture);
  expect(await pending).toBeNull();
});

it('forwards a hardware-ended track and removes its listener on release', async () => {
  const handle = await nativeCamera(new AbortController().signal);
  const ended = jest.fn();
  handle.onEnded!(ended);
  expect(mockTrack.addEventListener).toHaveBeenCalledWith('ended', ended);
  mockTrack.addEventListener.mock.calls[0][1]();
  expect(ended).toHaveBeenCalledTimes(1);
  handle.release();
  expect(mockTrack.removeEventListener).toHaveBeenCalledWith('ended', ended);
});
