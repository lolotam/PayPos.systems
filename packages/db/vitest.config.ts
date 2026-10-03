import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // اختبارات الدور ومهل Postgres تتشارك السيرفر نفسه؛ لا ننافس القياسات بملفات أخرى.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
    // تشمل clone/checkpoint والتجهيز؛ assertions ومهلة OTP نفسها لا تتغير.
    hookTimeout: 120_000,
  },
});
