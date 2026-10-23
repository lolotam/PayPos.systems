import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const testing = process.env.VITEST === 'true';

export default defineConfig(({ mode }) => {
  // نسخة التطبيق الأصلي: الأصول بتاعته جوّه التطبيق نفسه، فمفيش service worker ولا manifest
  // (ADR-0055 قرار 3)، والبناء بيطلع في مجلد مستقل عشان build الويب ما يتغيرش.
  const native = mode === 'native';
  // نفس الـ host بتاع نسخة التطبيق (ADR-0055 قرار 4): لينك المدير بيتقرأ من الـ host ده بالظبط،
  // والنسختين (staging و production) ليهما host مختلف.
  const posHost =
    process.env.FLAVOUR === 'production' ? 'pos.pospay.systems' : 'pos.staging.pospay.systems';

  return {
    envDir: fileURLToPath(new URL('../..', import.meta.url)),
    ...(native ? { build: { outDir: 'dist-native' } } : {}),
    ...(native
      ? {
          define: {
            'import.meta.env.VITE_NATIVE': JSON.stringify('1'),
            'import.meta.env.VITE_POS_HOST': JSON.stringify(posHost),
          },
        }
      : {}),
    plugins: [
      react(),
      tailwindcss(),
      testing || native
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
              theme_color: '#FF6421',
              background_color: '#FCFAF6',
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
  };
});
