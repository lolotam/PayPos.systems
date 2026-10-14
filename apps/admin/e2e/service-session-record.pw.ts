import { expect, test, type Page } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

import {
  findOrCreateCustomer,
  fillLine,
  kuwaitDate,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
  savedVisit,
  setOccurredAt,
  submitVisit,
  type DayLine,
  type DayVisit,
  type LineSpec,
} from './session-fixture';

const state = loadState();

function amountSpec(): LineSpec {
  return {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [performerAt(state, 0).name],
  };
}

function expectShares(line: DayLine | undefined, money: Partial<DayLine>, shares: readonly number[]): void {
  expect(line).toMatchObject(money);
  expect(line?.performers.map((person) => person.share_bps)).toEqual(shares);
  expect(line?.performers.map((person) => person.employee_id)).toEqual(
    shares.map((_, index) => performerAt(state, index).id),
  );
}

async function saveAmount(page: Page, locale: Locale): Promise<void> {
  const customer = label('Amount');
  await openRecorder(page, state, locale);
  await findOrCreateCustomer(page, locale, customer, nationalNumber());
  await fillLine(page, locale, 0, amountSpec());
  const response = await submitVisit(page, locale, 'create');
  expect(response.status()).toBe(201);
  expect((await response.json()) as { outcome: string }).toMatchObject({ outcome: 'COMPLETE' });
  await expect(page.getByRole('status').filter({ hasText: t(locale, 'serviceSessions.saved') }).first()).toBeVisible();
  const visit = await savedVisit(state, customer, kuwaitDate(0));
  expect(visit.late).toBe(false);
  expectShares(visit.lines[0], {
    service_id: state.standardServiceId,
    price: '25.000',
    list_price: '25.000',
    discount: '1.000',
    net: '24.000',
    late: false,
  }, [10_000]);
}

async function recordLate(page: Page): Promise<{ customer: string; visit: DayVisit }> {
  const customer = label('Late');
  await openRecorder(page, state, 'en');
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await setOccurredAt(page, 'en', `${kuwaitDate(-1)}T15:00`);
  await fillLine(page, 'en', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'PERCENT', value: '5' },
    performers: [0, 1, 2, 3].map((index) => performerAt(state, index).name),
  });
  await expect(page.getByText(t('en', 'serviceSessions.notClockedIn')).first()).toBeVisible();
  const response = await submitVisit(page, 'en', 'create');
  expect(response.status()).toBe(201);
  await expect(page.getByText(t('en', 'serviceSessions.late')).first()).toBeVisible();
  const visit = await savedVisit(state, customer, kuwaitDate(-1));
  expect(visit.late).toBe(true);
  expectShares(visit.lines[0], { price: '25.000', list_price: '25.000', discount: '1.250', net: '23.750', late: true }, [
    2500, 2500, 2500, 2500,
  ]);
  return { customer, visit };
}

async function appendLate(page: Page, customer: string, before: DayVisit): Promise<void> {
  await fillLine(page, 'en', 0, amountSpec());
  const response = await submitVisit(page, 'en', 'append');
  expect(response.status()).toBe(201);
  const after = await savedVisit(state, customer, kuwaitDate(-1));
  expect(after.occurred_at).toBe(before.occurred_at);
  expect(after.lines[0]?.id).toBe(before.lines[0]?.id);
  expect(after.lines).toHaveLength(2);
  expect(after.late).toBe(true);
  expect(after.lines.every((line) => line.late)).toBe(true);
  expectShares(after.lines[1], { price: '25.000', discount: '1.000', net: '24.000', late: true }, [10_000]);
}

async function recordOverride(page: Page): Promise<void> {
  const customer = label('Override');
  await openRecorder(page, state, 'ar');
  await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
  await fillLine(page, 'ar', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    price: '24.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [0, 1, 2, 3].map((index) => performerAt(state, index).name),
    shares: ['25', '25', '25', '25'],
  });
  const response = await submitVisit(page, 'ar', 'create');
  expect(response.status()).toBe(201);
  const visit = await savedVisit(state, customer, kuwaitDate(0));
  expectShares(
    visit.lines[0],
    { price: '24.000', list_price: '25.000', discount: '1.000', net: '23.000', late: false },
    [2500, 2500, 2500, 2500],
  );
}

for (const locale of ['ar', 'en'] as const) {
  test(`saves an amount discount in ${locale}`, async ({ page }) => {
    await saveAmount(page, locale);
  });
}

test('saves a late equal split and appends without moving the header', async ({ page }) => {
  const saved = await recordLate(page);
  await appendLate(page, saved.customer, saved.visit);
});

test('saves a price override with four custom shares in Arabic', async ({ page }) => {
  await recordOverride(page);
});

test.describe('narrow Arabic keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('submits a visit with Enter while the document is RTL', async ({ page }) => {
    const customer = label('Keys');
    await openRecorder(page, state, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
    await fillLine(page, 'ar', 0, amountSpec());
    const response = await submitVisit(page, 'ar', 'create', true);
    expect(response.status()).toBe(201);
    expect((await savedVisit(state, customer, kuwaitDate(0))).lines).toHaveLength(1);
  });
});
