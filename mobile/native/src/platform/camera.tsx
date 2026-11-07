import React, { useSyncExternalStore } from 'react';
import { CameraView, Camera } from 'expo-camera';
import { StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { loadRtc } from './capabilities';
import { nativeFetch } from './network';
import { duringPermission } from './permissions';
import type { CameraHandle } from '../session/controller';
import { WhipPublisher, type Peer, type Transport } from '../streaming/whip';
import { preferH264 } from '../streaming/codecs';

export class GoCamera {
  private active = false;
  private listeners = new Set<() => void>();
  private view: CameraView | null = null;
  private ready?: () => void;
  private failed?: () => void;
  getSnapshot = () => this.active;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  attach = (view: CameraView | null) => { this.view = view; };
  onReady = () => this.ready?.();
  onError = () => this.failed?.();
  private show(value: boolean) { this.active = value; this.listeners.forEach(fn => fn()); }
  acquire = async (signal: AbortSignal): Promise<CameraHandle> => {
    if (!(await duringPermission(() => Camera.requestCameraPermissionsAsync(), signal)).granted || signal.aborted) throw Error('camera_denied');
    let released = false;
    const release = () => { if (released) return; released = true; this.show(false); this.view = null; };
    await new Promise<void>((resolve, reject) => {
      const finish = (ok: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.ready = undefined; this.failed = undefined; if (ok) resolve(); else { release(); reject(Error('camera_denied')); } };
      const abort = () => finish(false);
      const timer = setTimeout(abort, 15000);
      this.ready = () => finish(true); this.failed = abort; signal.addEventListener('abort', abort, { once: true }); this.show(true);
    });
    if (signal.aborted) { release(); throw Error('cancelled'); }
    return { release, snapshot: async () => {
      if (released || !this.view) return;
      const capturedAt = new Date().toISOString();
      const image = await this.view.takePictureAsync({ quality: 0.5, shutterSound: false });
      if (!image) return;
      if (released || signal.aborted) { await FileSystem.deleteAsync(image.uri, { idempotent: true }).catch(() => {}); return; }
      return { uri: image.uri, capturedAt };
    } };
  };
}
export function GoCameraPreview({ camera }: { camera: GoCamera }) {
  const active = useSyncExternalStore(camera.subscribe, camera.getSnapshot);
  return active ? <CameraView ref={camera.attach} style={StyleSheet.absoluteFill} facing="back" mode="picture" onCameraReady={camera.onReady} onMountError={camera.onError} /> : null;
}
let acquiring: Promise<unknown> = Promise.resolve();
export function nativeCamera(signal: AbortSignal): Promise<CameraHandle> {
  const previous = acquiring;
  const next = (async () => {
  await previous.catch(() => {});
  if (signal.aborted) throw Error('cancelled');
  const rtc = loadRtc();
  const stream = await duringPermission(() => rtc.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: 1280, height: 720, frameRate: 15 } }), signal);
  let released = false;
  const release = () => { if (released) return; released = true; stream.getTracks().forEach(track => track.stop()); stream.release(); };
  if (signal.aborted) { release(); throw Error('cancelled'); }
  const camera = { url: stream.toURL(), release, stream };
  // Installed MediaStreamTrack has no frame/photo API. Do not open Expo Camera here.
  return camera;
  })();
  acquiring = next;
  return next;
}
export function nativePublisher(camera: CameraHandle, endpoint: string, state: (value: Transport) => void) {
  const rtc = loadRtc(), stream = (camera as CameraHandle & { stream: import('react-native-webrtc').MediaStream }).stream;
  const track = stream?.getVideoTracks()[0]; if (!track) throw Error('camera_unavailable');
  const peer = new rtc.RTCPeerConnection({ iceServers: [] });
  try {
    const transceiver = peer.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
    preferH264(() => rtc.RTCRtpSender.getCapabilities?.('video'), codecs => transceiver.setCodecPreferences?.(codecs));
  } catch (error) { peer.close(); throw error; }
  const publisher = new WhipPublisher(peer as unknown as Peer, state, nativeFetch);
  return { start: async () => {
    try { await publisher.start(endpoint); }
    catch (error) {
      if (__DEV__) console.warn('Aether stream failed', new URL(endpoint).origin, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, stop: () => publisher.stop() };
}
export function RtcPreview({ url }: { url: string }) {
  const { RTCView } = loadRtc();
  return <RTCView streamURL={url} objectFit="cover" mirror={false} style={StyleSheet.absoluteFill} />;
}
