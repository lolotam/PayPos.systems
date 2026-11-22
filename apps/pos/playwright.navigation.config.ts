import { defineConfig } from '@playwright/test';

// CI-only isolated navigation component fixture config; separate from POS app E2E.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/navigation-components.pw.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: process.env['POS_E2E_URL'], serviceWorkers: 'block' },
});
