module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.native.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/nativeSetup.cjs'],
  cacheDirectory: '<rootDir>/.runtime/jest-cache',
  maxWorkers: 1,
};
