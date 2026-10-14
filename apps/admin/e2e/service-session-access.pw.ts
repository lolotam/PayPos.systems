import { expect, test } from '@playwright/test';
import { t } from '@pospay/i18n';

import {
  chooseCompany,
  civilDate,
  dayVisits,
  documentLocale,
  dropFirstCreate,
  fillLine,
  findOrCreateCustomer,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
  signInThroughUi,
} from './session-fixture';

const state = loadState();

test('hides the form on a branch the recorder cannot record', async ({ page }) => {
  const zone = await openRecorder(page, state, 'ar');
  const date = civilDate(zone, 0);
  const pending = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'GET') return false;
    return (
      new URL(response.url()).pathname.includes(
        `/branches/${state.otherBranchId}/service-sessions/recording-context`,
      ) && request.headers()['x-company-id'] === state.otherCompanyId
    );
  }, { timeout: 20_000 });
  await chooseCompany(page, state.otherCompanyName);
  expect((await pending).status()).toBe(403);
  await expect(page.getByRole('button', { name: t('ar', 'serviceSessions.save') })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: /\S/u })).toBeVisible();
  const refused = await page.request.post(
    `${state.apiBase}/v1/businesses/${state.otherBusinessId}/branches/${state.otherBranchId}/service-sessions`,
    {
      headers: {
        origin: state.origin,
        'content-type': 'application/json',
        'x-company-id': state.otherCompanyId,
        'idempotency-key': crypto.randomUUID(),
      },
      data: {},
    },
  );
  expect(refused.status()).toBe(403);
  expect(await dayVisits(state, 'other', date)).toEqual([]);
});

test('clears the draft when another person signs in', async ({ page }) => {
  const customer = label('Identity');
  await openRecorder(page, state, 'ar');
  await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
  await fillLine(page, 'ar', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [performerAt(state, 0).name],
  });
  const dropped = await dropFirstCreate(page);
  await page.getByRole('button', { name: t('ar', 'serviceSessions.save') }).click();
  expect((await dropped()).status()).toBe(201);
  await expect(page.getByRole('alert').filter({ hasText: t('ar', 'serviceSessions.unresolved') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('ar', 'serviceSessions.retryOriginal') })).toBeVisible();
  await expect(page.getByText(customer)).toBeVisible();
  const other = await page.context().newPage();
  await signInThroughUi(other, state.otherEmail, state.otherPassword);
  await expect(page.locator('#workspace-company')).toContainText(state.otherCompanyName);
  const locale = await documentLocale(page);
  await expect(page.getByRole('heading', { name: t(locale, 'serviceSessions.title') })).toBeVisible();
  await expect(page.getByLabel(t(locale, 'serviceSessions.name'), { exact: true })).toHaveValue('');
  await expect(page.getByText(customer)).toHaveCount(0);
  await expect(page.getByRole('button', { name: t(locale, 'serviceSessions.retryOriginal') })).toHaveCount(0);
  await other.close();
});
