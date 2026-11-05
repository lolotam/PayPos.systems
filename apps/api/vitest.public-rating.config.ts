import { defineConfig } from 'vitest/config';

// اختبارات HTTP/config هنا بلا قاعدة بيانات؛ createApp يعمل بقدرات tenant غير مفعلة.
export default defineConfig({
  test: {
    include: [
      'src/shared/__tests__/public-rating-cors.spec.ts',
      'src/shared/__tests__/config.spec.ts',
    ],
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
