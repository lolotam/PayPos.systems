import { fileURLToPath } from 'node:url';

import { POS_HOSTS } from '@pospay/contracts';
import { THEME_BOOT_SCRIPT, THEME_COLOR_METAS, THEME_COLORS } from '@pospay/ui/theme';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const themeColorMetas = THEME_COLOR_METAS.map(({ media, content }) => ({
  tag: 'meta',
  attrs: {
    name: 'theme-color',
    content,
    media,
  },
  injectTo: 'head' as const,
}));

const themeBootPlugin = {
  name: 'souk-theme-boot',
  transformIndexHtml: () => [
    // الـ metas الأول عشان سكربت الإقلاع يلاقي أول meta لـ theme-color في الشجرة،
    // فيدرَج الـ meta المملوكة قبلها؛ لو مش موجودة بيفضل الـ head-prepend fallback.
    ...themeColorMetas,
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

/**
 * الثوابت بتاعة نسخة التطبيق الأصلي: الـ host والـ flavour وقدرات الكاميرا (M-1d).
 *
 * قدرات الكاميرا كل واحدة في متغير بناء لوحدها، والافتراضي مقفول لأن التطبيق لازم
 * يبقى خفيف من غير ما نطلب إذن الكاميرا من غير سبب.
 *
 * @param flavour نوع النسخة: staging أو production
 * @param posHost الـ host المضمون في النسخة
 * @returns خريطة التعريفات بتاعة البناء
 */
function nativeDefines(flavour: string, posHost: string) {
  const qrScan = process.env.VITE_NATIVE_QR_SCAN === '1' ? '1' : '0';
  const attendanceCamera = process.env.VITE_NATIVE_ATTENDANCE_CAMERA === '1' ? '1' : '0';
  return {
    'import.meta.env.VITE_NATIVE': JSON.stringify('1'),
    'import.meta.env.VITE_POS_HOST': JSON.stringify(posHost),
    'import.meta.env.VITE_NATIVE_FLAVOUR': JSON.stringify(flavour),
    'import.meta.env.VITE_NATIVE_QR_SCAN': JSON.stringify(qrScan),
    'import.meta.env.VITE_NATIVE_ATTENDANCE_CAMERA': JSON.stringify(attendanceCamera),
  };
}

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
    ...(native ? { define: nativeDefines(flavour, posHost) } : {}),
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
            manifest: {
              name: 'PosPay',
              short_name: 'PosPay',
              dir: 'rtl',
              lang: 'ar',
              display: 'standalone',
              start_url: '/',
              scope: '/',
              theme_color: THEME_COLORS.light,
              background_color: THEME_COLORS.light,
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
