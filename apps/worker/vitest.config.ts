import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // نافذة STOP/OTP تقاس دون تزاحم WAL من fixtures لملفات أخرى.
    fileParallelism: false,
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    hookTimeout: 120_000,
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
  },
});
