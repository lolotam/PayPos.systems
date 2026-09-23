import { defineConfig } from 'vitest/config';

// Integration tests run on the compose Postgres through packages/db's harness (ADR-0006): one migrated
// template per run, one cloned database per spec file.
export default defineConfig({
  test: {
    globalSetup: ['../db/test/global-setup.ts'],
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
