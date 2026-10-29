import { loadRTC } from '../native/capabilities';
import type { RtcFactory } from './WhipPublisher';
export async function acquireNativeCamera() {
  const rtc = loadRTC();
  if (!rtc) throw new Error('Native WebRTC module is missing');
  const stream = await rtc.mediaDevices.getUserMedia({ audio: false, video: {
    facingMode: 'environment', width: 1280, height: 720, frameRate: 15,
  } });
  return stream;
}
export function releaseCamera(stream: Awaited<ReturnType<typeof acquireNativeCamera>>) {
  stream.getTracks().forEach(track => track.stop());
  stream.release();
}
export function rtcFactory(): RtcFactory {
  const rtc = loadRTC();
  if (!rtc) throw new Error('Native WebRTC module is missing');
  return {
    createPeer: () => new rtc.RTCPeerConnection({ iceServers: [] }),
    preferH264: peer => {
      const codecs = rtc.RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const h264 = codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264');
      if (!h264.length) return false;
      peer.getTransceivers().find(item => item.sender.track?.kind === 'video')?.setCodecPreferences([
        ...h264, ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264'),
      ]);
      return true;
    },
  };
}
