import { defineConfig } from '@playwright/test';

// Recorridos completos: las pantallas de verdad contra el backend de verdad, con una base propia
// (ver e2e/servidor-api.mjs). Van en orden y de uno en uno porque comparten esa base: primero la
// tablet (donde el administrador registra el equipo) y después el celular.
const PUERTO_API = '3100';
const PUERTO_APP = '5174';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PUERTO_APP}`,
    locale: 'es-NI',
    timezoneId: 'America/Managua',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'tablet',
      testMatch: 'tablet.spec.ts',
      use: { browserName: 'chromium', viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
    {
      name: 'celular',
      testMatch: 'celular.spec.ts',
      dependencies: ['tablet'],
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      // Las dos sucursales a la vez, cada una con su celular del negocio
      name: 'caja',
      testMatch: 'caja.spec.ts',
      dependencies: ['celular'],
      use: { browserName: 'chromium', hasTouch: true },
    },
  ],
  webServer: [
    {
      command: 'node e2e/servidor-api.mjs',
      url: `http://localhost:${PUERTO_API}/api/salud`,
      env: { PUERTO_API },
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${PUERTO_APP} --strictPort`,
      url: `http://localhost:${PUERTO_APP}`,
      env: { API_DESTINO: `http://localhost:${PUERTO_API}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
