import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    include: ['test/production-otp-smoke.spec.ts'],
    testTimeout: 60_000,
    // تجهيز الـ fixture فقط؛ lifetime لكل built child يظل أقل من 20 ثانية.
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
