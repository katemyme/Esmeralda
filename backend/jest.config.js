// Pruebas unitarias (src/**/*.spec.ts), de integración contra PostgreSQL (src/**/*.spec.ts)
// y de la API con supertest (test/**/*.e2e-spec.ts). Todas usan una base de prueba que
// test/preparar-bd.mjs recrea desde cero al inicio de cada corrida.
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  globalSetup: '<rootDir>/test/preparar-bd.mjs',
  testEnvironment: 'node',
};
