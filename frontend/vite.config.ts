import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// La API y las pantallas se sirven desde el mismo origen: en desarrollo, Vite reenvía /api al
// backend (por defecto http://localhost:3000). Así las cookies de sesión (SameSite=Strict) y la del
// equipo registrado funcionan igual que en producción, también detrás de un túnel con HTTPS.
const api = process.env.API_DESTINO ?? 'http://localhost:3000';
const reenvio = { '/api': { target: api, xfwd: true } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['iconos/icono.svg', 'iconos/icono-180.png'],
      manifest: {
        name: 'Esmeralda Experience',
        short_name: 'Esmeralda',
        description: 'Inventario, ventas y caja de Esmeralda Experience',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FAF8F3',
        theme_color: '#064E3B',
        icons: [
          { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/iconos/icono-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Solo se guarda la aplicación (para que abra rápido): nunca una respuesta de la API
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // El túnel de Cloudflare para probar en la tablet y el celular (https://….trycloudflare.com)
    allowedHosts: ['.trycloudflare.com'],
    proxy: reenvio,
  },
  preview: { host: true, port: 4173, allowedHosts: ['.trycloudflare.com'], proxy: reenvio },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/pruebas/preparar.ts'],
    css: false,
    restoreMocks: true,
  },
});
