import { defineConfig } from 'vitest/config';

// المسار المؤقت يطبّق SQL المرشّح على template الخاص قبل نسخ قواعد كل spec.
export default defineConfig({ test: {
  fileParallelism: false, globalSetup: ['./test/redemption-candidate-setup.ts'],
  include: ['src/**/*.spec.ts'], testTimeout: 20_000, hookTimeout: 120_000,
} });
