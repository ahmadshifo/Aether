import { requireOptionalNativeModule } from 'expo';
import { Camera } from 'expo-camera';
import { NativeModules } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import type { DepthReading, DepthSnapshot } from '../session/depth';
import { duringPermission } from './permissions';

type Rtc = Pick<typeof import('react-native-webrtc'), 'MediaStream'>;
type StreamInfo = Extract<ConstructorParameters<Rtc['MediaStream']>[0], { streamId: string }>;
interface DepthModule {
  open(): Promise<StreamInfo | null>;
  cancelOpen?(): void;
  read(streamId: string): DepthReading | null;
  snapshot(streamId: string): Promise<DepthSnapshot | null>;
}

function releaseUnwrapped(info: StreamInfo) {
  // If the RN wrapper cannot be constructed, the native camera already owns a
  // registered WebRTC stream. Release by ID before asking for the ordinary camera.
  const rtc = NativeModules.WebRTCModule;
  for (const track of info.tracks ?? []) {
    if (!track?.id) continue;
    if (info.streamReactTag) rtc.mediaStreamRemoveTrack(info.streamReactTag, -1, track.id);
    rtc.mediaStreamTrackRelease(track.id);
  }
  if (info.streamReactTag) rtc.mediaStreamRelease(info.streamReactTag);
}

export async function openDepthCamera(rtc: Rtc, signal: AbortSignal) {
  // Android exposes an Expo Module; iOS uses an RCT module to share WebRTC's worker queue.
  const native = requireOptionalNativeModule<DepthModule>('AetherDepth') ??
    (NativeModules.AetherDepth as DepthModule | undefined);
  if (!native?.open || !native.read) return null;
  const info = await duringPermission(async () => {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (signal.aborted) throw Error('cancelled');
    if (!permission.granted) throw Error('camera_denied');
    // Play Services for AR may offer its optional system installation dialog here.
    const cancel = () => native.cancelOpen?.();
    signal.addEventListener('abort', cancel, { once: true });
    try { return await native.open(); } catch { return null; }
    finally { signal.removeEventListener('abort', cancel); }
  }, signal);
  if (!info) return null;
  if (signal.aborted) { releaseUnwrapped(info); throw Error('cancelled'); }
  let stream: MediaStream;
  try { stream = new rtc.MediaStream(info); }
  catch { releaseUnwrapped(info); return null; }
  if (stream.getVideoTracks().length !== 1) { stream.release(); return null; }
  return {
    stream,
    readDepth(): DepthReading | null {
      try { return native.read(info.streamId); } catch { return null; }
    },
    async depthSnapshot(): Promise<DepthSnapshot | null> {
      try { return await native.snapshot(info.streamId); } catch { return null; }
    },
  };
}
