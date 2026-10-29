const allowLanHttp = process.env.ECHOSIGHT_ALLOW_LAN_HTTP === '1';
module.exports = {
  expo: {
    name: 'EchoSight', slug: 'echosight-native', version: '1.0.0',
    scheme: 'echosight', orientation: 'portrait', userInterfaceStyle: 'dark',
    platforms: ['ios', 'android'],
    ios: {
      bundleIdentifier: 'com.echosight.mobile', supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: 'EchoSight uses the rear camera for live visual assistance.',
        NSMicrophoneUsageDescription: 'EchoSight recognizes your spoken questions.',
        NSSpeechRecognitionUsageDescription: 'EchoSight converts spoken questions to text using device speech services.',
        NSLocalNetworkUsageDescription: 'EchoSight connects to your authorized local MediaMTX server.',
        NSAppTransportSecurity: allowLanHttp
          ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
          : { NSAllowsLocalNetworking: true },
        CFBundleLocalizations: ['en', 'ar'],
      },
    },
    android: { package: 'com.echosight.mobile', permissions: ['CAMERA', 'RECORD_AUDIO', 'INTERNET'] },
    plugins: [
      ['expo-camera', { cameraPermission: 'Allow EchoSight to use your camera.', recordAudioAndroid: false }],
      ['expo-build-properties', { android: { usesCleartextTraffic: allowLanHttp } }],
      ['@config-plugins/react-native-webrtc', {
        cameraPermission: 'Allow EchoSight to stream your camera on your authorized network.',
        microphonePermission: 'Allow EchoSight to recognize spoken questions.',
      }],
      ['expo-speech-recognition', {
        microphonePermission: 'Allow EchoSight to recognize spoken questions.',
        speechRecognitionPermission: 'Allow EchoSight to use device speech recognition.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as', 'com.google.android.tts'],
      }],
    ],
  },
};
