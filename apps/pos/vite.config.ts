import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const testing = process.env.VITEST === 'true';

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    testing
      ? null
      : VitePWA({
          registerType: 'autoUpdate',
          manifestFilename: 'manifest.webmanifest',
          includeAssets: ['icon.svg'],
          manifest: {
            name: 'PosPay',
            short_name: 'PosPay',
            dir: 'rtl',
            lang: 'ar',
            display: 'standalone',
            start_url: '/',
            scope: '/',
            theme_color: '#171717',
            background_color: '#fafafa',
            icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
            navigateFallback: 'index.html',
          },
          devOptions: { enabled: false },
        }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    env: { VITE_API_URL: 'http://127.0.0.1:3000' },
  },
});
