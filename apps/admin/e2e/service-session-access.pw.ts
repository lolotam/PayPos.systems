import { expect, test } from '@playwright/test';
import { t } from '@pospay/i18n';

import {
  chooseCompany,
  dayVisits,
  findOrCreateCustomer,
  kuwaitDate,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  signInThroughUi,
} from './session-fixture';

const state = loadState();

test('hides the form on a branch the recorder cannot record', async ({ page }) => {
  await openRecorder(page, state, 'ar');
  const pending = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/recording-context'),
    { timeout: 20_000 },
  );
  await chooseCompany(page, state.otherCompanyName);
  expect((await pending).status()).toBe(403);
  await expect(page.getByRole('button', { name: t('ar', 'serviceSessions.save') })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: /\S/u })).toBeVisible();
  expect(await dayVisits(state, 'other', kuwaitDate(0))).toEqual([]);
});

test('clears the draft when another person signs in', async ({ page }) => {
  const customer = label('Identity');
  await openRecorder(page, state, 'ar');
  await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
  await expect(page.getByText(customer)).toBeVisible();
  await page.getByRole('button', { name: t('ar', 'admin.signOut') }).click();
  await page.waitForURL('**/login');
  await signInThroughUi(page, state.otherEmail, state.otherPassword);
  await page.goto('/orders/service-sessions/new');
  await expect(page.getByRole('button', { name: t('ar', 'serviceSessions.save') })).toBeVisible();
  await expect(page.getByLabel(t('ar', 'serviceSessions.name'), { exact: true })).toHaveValue('');
  await expect(page.getByText(customer)).toHaveCount(0);
});
