import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { NativeModules } from 'react-native';
export function capabilities() {
  const go = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return { go, webrtc: !go && !!NativeModules.WebRTCModule, recognition: !go && !!requireOptionalNativeModule('ExpoSpeechRecognition') };
}
// Literal requires are Metro-resolvable but execute only after the installed binary check.
export function loadRtc() {
  if (!capabilities().webrtc) throw Error('native_required');
  return require('react-native-webrtc') as typeof import('react-native-webrtc');
}
export function loadRecognition() {
  if (!capabilities().recognition) throw Error('native_required');
  return (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
}
