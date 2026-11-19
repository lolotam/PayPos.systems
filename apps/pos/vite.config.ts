import { fileURLToPath } from 'node:url';

import { THEME_BOOT_SCRIPT } from '@pospay/ui/theme';

import { POS_HOSTS } from '@pospay/contracts';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const themeBootPlugin = {
  name: 'souk-theme-boot',
  transformIndexHtml: () => [
    { tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head' as const },
  ],
};

const appIcons = [192, 512].flatMap((size) => [
  {
    src: `android-chrome-${size}x${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: `maskable-icon-${size}x${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'maskable',
  },
]);

const testing = process.env.VITEST === 'true';

export default defineConfig(({ mode }) => {
  // نسخة التطبيق الأصلي: الأصول بتاعته جوّه التطبيق نفسه، فمفيش service worker ولا manifest
  // (ADR-0055 قرار 3)، والبناء بيطلع في مجلد مستقل عشان build الويب ما يتغيرش.
  const native = mode === 'native';
  // نسخة البناء (staging أو production) بتتحدد بمتغير واحد (ADR-0055 قرار 4): منه الـ host
  // والـ flavour اللي جوّه البناء، عشان الشرط ما يتكررش في مكانين ويختلفوا مع بعض.
  const flavour = process.env.FLAVOUR === 'production' ? 'production' : 'staging';
  // نفس الـ host بتاع نسخة التطبيق (ADR-0055 قرار 4): لينك المدير بيتقرأ من الـ host ده بالظبط،
  // والنسختين (staging و production) ليهما host مختلف.
  const posHost = flavour === 'production' ? POS_HOSTS.production : POS_HOSTS.staging;

  return {
    envDir: fileURLToPath(new URL('../..', import.meta.url)),
    ...(native ? { build: { outDir: 'dist-native' } } : {}),
    ...(native
      ? {
          define: {
            'import.meta.env.VITE_NATIVE': JSON.stringify('1'),
            'import.meta.env.VITE_POS_HOST': JSON.stringify(posHost),
            'import.meta.env.VITE_NATIVE_FLAVOUR': JSON.stringify(flavour),
          },
        }
      : {}),
    plugins: [
      themeBootPlugin,
      react(),
      tailwindcss(),
      testing || native
        ? null
        : VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            registerType: 'autoUpdate',
            manifestFilename: 'manifest.webmanifest',
            includeAssets: ['*.png', '*.ico', 'brand/*.png'],
            manifest: {
              name: 'PosPay',
              short_name: 'PosPay',
              dir: 'rtl',
              lang: 'ar',
              display: 'standalone',
              start_url: '/',
              scope: '/',
              theme_color: '#EEF4F2',
              background_color: '#EEF4F2',
              icons: appIcons,
            },
            injectManifest: {
              globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
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
