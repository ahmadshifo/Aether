global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///synthetic-test/', getInfoAsync: jest.fn(async () => ({ exists: false })), readDirectoryAsync: jest.fn(async () => []), deleteAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}), makeDirectoryAsync: jest.fn(async () => {}) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn(async () => { throw Error('Network disabled in component tests'); }) }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));
jest.mock('expo-speech', () => ({ getAvailableVoicesAsync: jest.fn(async () => [{ identifier: 'en-test', language: 'en-US' }, { identifier: 'ar-test', language: 'ar-SA' }]), stop: jest.fn(async () => {}), speak: jest.fn((_text, options) => { options.onStart?.(); options.onDone?.(); }) }));
// Throw if the app evaluates a missing custom module in the Expo Go runtime.
jest.mock('react-native-webrtc', () => { throw Error('WebRTC must not be imported in Go'); });
jest.mock('expo-speech-recognition', () => { throw Error('Recognition must not be imported in Go'); });
