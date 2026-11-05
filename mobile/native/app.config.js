// Trusted HTTPS by default. Opt in when building: AETHER_LAN_HOST=<one private host>, or =any for a test APK that
// may need any private address (home Wi-Fi addresses change). The app's LAN switch still limits HTTP to private hosts.
const lanHost = process.env.AETHER_LAN_HOST || '';
module.exports = {
  expo: {
    name: 'Aether', slug: 'aether-native-local', version: '0.1.0', scheme: 'aether-local', icon: './assets/icon.png',
    orientation: 'portrait', userInterfaceStyle: 'automatic', extra: { eas: { projectId: '3c774f20-07c4-4b43-baa8-e94b54cec6d4' } },
    ios: { supportsTablet: false, bundleIdentifier: 'local.aether.nativeexperiment', infoPlist: {
      NSCameraUsageDescription: 'Aether uses the rear camera only after Start for preview and your chosen local video stream.',
      NSMicrophoneUsageDescription: 'Aether listens to your spoken questions during an active session and, if you turn it on, for "Hey Aether" while the app is open.',
      NSSpeechRecognitionUsageDescription: 'Aether uses system speech recognition to transcribe your questions.',
      NSLocalNetworkUsageDescription: 'Connect to your isolated SQLite test service and MediaMTX on your local laptop.',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, ...(lanHost ? { NSAllowsLocalNetworking: true,
        ...(lanHost === 'any' ? {} : { NSExceptionDomains: { [lanHost]: { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } } }),
      } : {}) },
    } },
    android: { package: 'local.aether.nativeexperiment', allowBackup: false, adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#202020' }, permissions: ['CAMERA', 'RECORD_AUDIO', 'INTERNET'], blockedPermissions: ['android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'], softwareKeyboardLayoutMode: 'resize' },
    plugins: [
      'expo-dev-client', ['expo-camera', { cameraPermission: 'Allow Aether to preview your camera after Start.', microphonePermission: false, recordAudioAndroid: false }],
      ['expo-speech-recognition', { microphonePermission: 'Allow Aether to hear your questions after Start.', speechRecognitionPermission: 'Allow Aether to transcribe your questions with system speech recognition.' }],
      ['@config-plugins/react-native-webrtc', { cameraPermission: 'Allow Aether to preview and publish video after Start.', microphonePermission: 'Allow Aether to hear your questions after Start.' }],
      // R8 stops on a class react-native-webrtc only references, and shrinking could remove what WebRTC calls at runtime.
      ['expo-build-properties', { android: { enableMinifyInReleaseBuilds: false, enableShrinkResourcesInReleaseBuilds: false } }],
      'expo-font', 'expo-sharing', 'expo-status-bar', ['./plugins/withLocalNetwork.cjs', { host: lanHost }],
    ],
  },
};
