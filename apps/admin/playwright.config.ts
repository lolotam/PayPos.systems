import { defineConfig } from '@playwright/test';

// يستعمل نسخة متاحة مسبقاً؛ لا webServer ولا dev/watch command في هذا الاختبار.
// عامل واحد: المستأجر المزروع مشترك، ورمز TOTP له نافذة 30 ثانية.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env['ADMIN_E2E_URL'],
    serviceWorkers: 'block',
    actionTimeout: 20_000,
  },
});
