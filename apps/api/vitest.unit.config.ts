import { defineConfig } from 'vitest/config';

// اختبارات domain والوحدات الصافية لا تحتاج تهيئة Postgres الخاصة باختبارات الـ API التكاملية.
export default defineConfig({
  test: {
    include: [
      'src/modules/*/domain/__tests__/*.spec.ts',
      'src/modules/*/use-cases/**/*.unit.spec.ts',
      'scripts/**/*.spec.ts',
    ],
  },
});
