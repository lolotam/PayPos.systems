import { defineConfig } from 'vitest/config';

// The identity guard is proven against the compose Postgres through packages/db's harness (ADR-0006): one
// migrated template per run, one cloned database per spec file.
export default defineConfig({
  test: {
    // تجارب نافذة OTP ذات 200ms لا تتنافس مع كتابة WAL من ملفات اختبار أخرى.
    fileParallelism: false,
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
