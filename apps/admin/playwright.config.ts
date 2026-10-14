import { defineConfig } from '@playwright/test';

const adminUrl = process.env['ADMIN_E2E_URL'];
if (adminUrl === undefined || adminUrl === '') throw new Error('e2e needs ADMIN_E2E_URL');

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
    baseURL: adminUrl,
    serviceWorkers: 'block',
    actionTimeout: 20_000,
  },
});
