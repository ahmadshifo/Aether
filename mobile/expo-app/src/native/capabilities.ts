import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
// Literal requires remain resolvable by Metro, but execute only in supported binaries.
const nativeBuild = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
export const rtcAvailable = nativeBuild && Boolean(NativeModules.WebRTCModule);
export const recognitionAvailable = nativeBuild && Boolean(requireOptionalNativeModule('ExpoSpeechRecognition'));
export function loadRTC(): typeof import('react-native-webrtc') | null {
  return rtcAvailable ? require('react-native-webrtc') : null;
}
export function loadRecognition(): typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule | null {
  return recognitionAvailable ? require('expo-speech-recognition').ExpoSpeechRecognitionModule : null;
}
