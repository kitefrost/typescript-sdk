/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.test.json',
      },
    ],
  },
  // Root suite ONLY. Each workspace under packages/* declares its own runner in
  // its package.json (`@kitefrost/core` uses node:test via tsx), and the root
  // `npm test` chains them. The old '**/tests/**' glob dragged packages/core's
  // node:test file into jest, where it reported "suite failed to run / 0 tests"
  // even though all 6 of its tests pass under their own runner.
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
};
