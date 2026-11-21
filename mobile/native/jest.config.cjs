module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/tests/**/*.native.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/nativeSetup.cjs'],
  cacheDirectory: '<rootDir>/.runtime/jest-cache',
  maxWorkers: 1,
};
