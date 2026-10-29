import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { loadRTC, rtcAvailable } from '../native/capabilities';
import type { MediaStream } from 'react-native-webrtc';
export function CameraPreview({ stream, onReady, onError }: { stream: MediaStream | null; onReady: () => void; onError: () => void }) {
  if (rtcAvailable) {
    const rtc = loadRTC();
    if (!rtc || !stream) return null;
    return <rtc.RTCView streamURL={stream.toURL()} mirror={false} objectFit="cover" style={StyleSheet.absoluteFill} />;
  }
  return <CameraView style={StyleSheet.absoluteFill} facing="back" mode="picture" mute
    onCameraReady={onReady} onMountError={onError} />;
}
