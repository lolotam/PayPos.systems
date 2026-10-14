import { expect, test, type Page, type Request } from '@playwright/test';
import { t } from '@pospay/i18n';

import {
  civilDate,
  dayVisits,
  dropFirstCreate,
  fillLine,
  findOrCreateCustomer,
  holdFirstCreate,
  isCreatePost,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
  readRecorded,
  staysQuiet,
  type DayVisit,
} from './session-fixture';

const state = loadState();

async function readyVisit(page: Page, prefix: string): Promise<{ customer: string; date: string }> {
  const customer = label(prefix);
  const zone = await openRecorder(page, state, 'ar');
  await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
  await fillLine(page, 'ar', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [performerAt(state, 0).name],
  });
  return { customer, date: civilDate(zone, 0) };
}

function watchCreates(page: Page): string[] {
  const keys: string[] = [];
  const remember = (request: Request) => {
    if (!isCreatePost(request.url(), request.method())) return;
    const key = request.headers()['idempotency-key'];
    if (key !== undefined) keys.push(key);
  };
  page.on('request', remember);
  return keys;
}

async function visitsFor(customer: string, date: string): Promise<DayVisit[]> {
  return (await dayVisits(state, 'owner', date)).filter((visit) => visit.customer.name === customer);
}

async function oneLine(customer: string, date: string, sessionId: string): Promise<void> {
  const visits = await visitsFor(customer, date);
  expect(visits).toHaveLength(1);
  expect(visits[0]?.id).toBe(sessionId);
  expect(visits[0]?.lines).toHaveLength(1);
  expect(visits[0]?.lines[0]).toMatchObject({
    service_id: state.standardServiceId,
    price: '25.000',
    list_price: '25.000',
    discount: '1.000',
    net: '24.000',
  });
}

test('replays a dropped 201 with the same key and one line', async ({ page }) => {
  const { customer } = await readyVisit(page, 'Lost');
  const keys = watchCreates(page);
  const dropped = await dropFirstCreate(page);
  await page.getByRole('button', { name: t('ar', 'serviceSessions.save') }).click();
  const fetched = await dropped();
  expect(fetched.status()).toBe(201);
  const created = (await fetched.json()) as { session: { id: string; business_date: string } };
  await expect(page.getByRole('alert').filter({ hasText: t('ar', 'serviceSessions.unresolved') })).toBeVisible();
  const replay = page.waitForResponse((response) => isCreatePost(response.url(), response.request().method()), {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: t('ar', 'serviceSessions.retryOriginal') }).click();
  const body = await readRecorded(await replay);
  expect(body.session.id).toBe(created.session.id);
  expect(body.session.business_date).toBe(created.session.business_date);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await oneLine(customer, created.session.business_date, body.session.id);
});

test('one double-click writes one visit', async ({ page }) => {
  const { customer } = await readyVisit(page, 'Click');
  const keys = watchCreates(page);
  const done = page.waitForResponse((response) => isCreatePost(response.url(), response.request().method()), {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: t('ar', 'serviceSessions.save') }).evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) return;
    element.click();
    element.click();
  });
  const body = await readRecorded(await done);
  await staysQuiet(async () => keys.length === 1 && (await visitsFor(customer, body.session.business_date)).length === 1);
  await oneLine(customer, body.session.business_date, body.session.id);
});

test('stays quiet when the browser reconnects', async ({ page }) => {
  const { customer, date } = await readyVisit(page, 'Offline');
  const keys = watchCreates(page);
  await holdFirstCreate(page);
  const save = page.getByRole('button', { name: t('ar', 'serviceSessions.save') });
  const retry = page.getByRole('button', { name: t('ar', 'serviceSessions.retryOriginal') });
  await save.click();
  await expect(page.getByRole('alert').filter({ hasText: t('ar', 'serviceSessions.unresolved') })).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: t('ar', 'serviceSessions.offline') })).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(retry).toHaveCount(0);
  await page.context().setOffline(false);
  await staysQuiet(async () => keys.length === 1 && (await visitsFor(customer, date)).length === 0);
  await expect(retry).toBeEnabled();
  const replay = page.waitForResponse((response) => isCreatePost(response.url(), response.request().method()), {
    timeout: 20_000,
  });
  await retry.click();
  const body = await readRecorded(await replay);
  expect(body.outcome).toBe('COMPLETE');
  expect(keys).toHaveLength(2);
  await oneLine(customer, body.session.business_date, body.session.id);
});
