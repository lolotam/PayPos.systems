import { expect, test, type Page, type Request } from '@playwright/test';
import { t } from '@pospay/i18n';

import {
  dayVisits,
  findOrCreateCustomer,
  fillLine,
  isCreatePost,
  kuwaitDate,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
} from './session-fixture';

const state = loadState();

async function readyVisit(page: Page, prefix: string): Promise<string> {
  const customer = label(prefix);
  await openRecorder(page, state, 'ar');
  await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
  await fillLine(page, 'ar', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [performerAt(state, 0).name],
  });
  return customer;
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

async function dropFirstCreate(page: Page): Promise<void> {
  let dropped = false;
  await page.route(
    (url) => /\/service-sessions$/u.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (dropped || !isCreatePost(request.url(), request.method())) {
        await route.continue();
        return;
      }
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    },
  );
}

async function oneVisit(customer: string): Promise<void> {
  const visits = (await dayVisits(state, 'owner', kuwaitDate(0))).filter((visit) => visit.customer.name === customer);
  expect(visits).toHaveLength(1);
  expect(visits[0]?.lines).toHaveLength(1);
}

test('replays a dropped 201 with the same key and one line', async ({ page }) => {
  const customer = await readyVisit(page, 'Lost');
  const keys = watchCreates(page);
  await dropFirstCreate(page);
  await page.getByRole('button', { name: t('ar', 'serviceSessions.save') }).click();
  await expect(page.getByRole('alert').filter({ hasText: t('ar', 'serviceSessions.unresolved') })).toBeVisible();
  const replay = page.waitForResponse((response) => isCreatePost(response.url(), response.request().method()), {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: t('ar', 'serviceSessions.retryOriginal') }).click();
  expect((await replay).status()).toBe(201);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await oneVisit(customer);
});

test('one double-click writes one visit', async ({ page }) => {
  const customer = await readyVisit(page, 'Click');
  const keys = watchCreates(page);
  const done = page.waitForResponse((response) => isCreatePost(response.url(), response.request().method()), {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: t('ar', 'serviceSessions.save') }).evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) return;
    element.click();
    element.click();
  });
  expect((await done).status()).toBe(201);
  await page.waitForTimeout(750);
  expect(keys).toHaveLength(1);
  await oneVisit(customer);
});

test('stays quiet when the browser reconnects', async ({ page }) => {
  await readyVisit(page, 'Offline');
  const keys = watchCreates(page);
  await page.context().setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: t('ar', 'serviceSessions.offline') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('ar', 'serviceSessions.save') })).toBeDisabled();
  await page.context().setOffline(false);
  await page.waitForTimeout(750);
  expect(keys).toHaveLength(0);
});
