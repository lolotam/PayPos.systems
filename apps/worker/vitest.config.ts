import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    hookTimeout: 60_000,
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
  },
});
