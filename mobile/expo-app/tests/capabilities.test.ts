import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(resolve('src/native/capabilities.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
test('Expo Go startup never evaluates missing WebRTC or recognition packages', () => {
  const exports: Record<string, any> = {}; const required: string[] = [];
  runInNewContext(compiled, { exports, require: (name: string) => {
    required.push(name);
    if (name === 'expo-constants') return { __esModule: true, default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } };
    if (name === 'react-native') return { Platform: { OS: 'ios' }, NativeModules: {} };
    if (name === 'expo') return { requireOptionalNativeModule: () => { throw Error('Must not probe Go'); } };
    throw Error(`Missing native module evaluated: ${name}`);
  } });
  assert.equal(exports.rtcAvailable, false); assert.equal(exports.recognitionAvailable, false);
  assert.equal(exports.loadRTC(), null); assert.equal(exports.loadRecognition(), null);
  assert.equal(required.includes('react-native-webrtc'), false); assert.equal(required.includes('expo-speech-recognition'), false);
});
