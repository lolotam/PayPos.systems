import { defineConfig } from '@playwright/test';

// يستعمل نسخة متاحة مسبقاً؛ لا webServer ولا dev/watch command في هذا الاختبار.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: process.env['POS_E2E_URL'], serviceWorkers: 'block' },
});
