import { expect, test, type Page, type Response } from '@playwright/test';
import { serviceSessionErrors, t, type Locale } from '@pospay/i18n';

import {
  addDraftLine,
  civilDate,
  dayVisits,
  findOrCreateCustomer,
  fillLine,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
  readRecorded,
  savedVisit,
  submitVisit,
  type DayVisit,
  type LineSpec,
} from './session-fixture';

const state = loadState();

interface RefusalBody {
  readonly code: string;
  readonly details: {
    readonly rejected_lines: readonly {
      readonly code: string;
      readonly price: string;
      readonly discount: string;
      readonly max_discount_amount: string;
      readonly limit_bps: number;
    }[];
  };
}

function oddPercent(value: string): LineSpec {
  return {
    serviceName: state.oddServiceName,
    catalogPrice: '7.125',
    discount: { kind: 'PERCENT', value },
    performers: [performerAt(state, 0).name],
  };
}

async function readRefusal(response: Response): Promise<RefusalBody> {
  expect(response.status()).toBe(422);
  return (await response.json()) as RefusalBody;
}

async function absent(customer: string, date: string): Promise<void> {
  const visits = await dayVisits(state, 'owner', date);
  expect(visits.filter((visit) => visit.customer.name === customer)).toHaveLength(0);
}

async function refuseOdd(page: Page, locale: Locale): Promise<void> {
  const customer = label('Odd');
  const zone = await openRecorder(page, state, locale);
  const date = civilDate(zone, 0);
  await findOrCreateCustomer(page, locale, customer, nationalNumber());
  await fillLine(page, locale, 0, oddPercent('10'));
  const body = await readRefusal(await submitVisit(page, locale, 'create'));
  expect(body.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(body.details.rejected_lines[0]).toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    price: '7.125',
    discount: '0.713',
    max_discount_amount: '0.712',
    limit_bps: 1000,
  });
  await absent(customer, date);
}

async function refuseAmount(page: Page): Promise<void> {
  const customer = label('Over');
  const zone = await openRecorder(page, state, 'en');
  const date = civilDate(zone, 0);
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await fillLine(page, 'en', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '5.000' },
    performers: [performerAt(state, 0).name],
  });
  const body = await readRefusal(await submitVisit(page, 'en', 'create'));
  expect(body.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  await absent(customer, date);
}

async function openPartial(page: Page, locale: Locale): Promise<{ customer: string; date: string }> {
  const customer = label('Partial');
  await openRecorder(page, state, locale);
  await findOrCreateCustomer(page, locale, customer, nationalNumber());
  await fillLine(page, locale, 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'AMOUNT', value: '1.000' },
    performers: [performerAt(state, 0).name],
  });
  await addDraftLine(page, locale);
  await fillLine(page, locale, 1, oddPercent('10'));
  const recorded = await readRecorded(await submitVisit(page, locale, 'create'));
  expect(recorded.outcome).toBe('PARTIAL');
  await expect(page.getByRole('status').filter({ hasText: t(locale, 'serviceSessions.partial') })).toBeVisible();
  return { customer, date: recorded.session.business_date };
}

async function keepRejected(page: Page, locale: Locale, customer: string, date: string): Promise<DayVisit> {
  const before = await savedVisit(state, customer, date);
  const body = await readRefusal(await submitVisit(page, locale, 'append'));
  expect(body.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  const after = await savedVisit(state, customer, date);
  expect(after.occurred_at).toBe(before.occurred_at);
  expect(after.lines.map((line) => line.id)).toEqual(before.lines.map((line) => line.id));
  return before;
}

async function correctPercent(
  page: Page,
  locale: Locale,
  before: DayVisit,
  customer: string,
  date: string,
): Promise<void> {
  await page.getByRole('button', { name: t(locale, 'serviceSessions.editRejected') }).click();
  const group = page.getByRole('group', {
    name: t(locale, 'serviceSessions.lineNumber').replace('{n}', '1'),
  });
  const field = group.getByLabel(t(locale, 'serviceSessions.discountPercent'), { exact: true });
  await field.fill('5');
  await field.blur();
  const recorded = await readRecorded(await submitVisit(page, locale, 'append'));
  expect(recorded.session.business_date).toBe(date);
  const after = await savedVisit(state, customer, date);
  expect(after.occurred_at).toBe(before.occurred_at);
  expect(after.lines[0]?.id).toBe(before.lines[0]?.id);
  expect(after.lines).toHaveLength(2);
  expect(after.lines[1]).toMatchObject({
    service_id: state.oddServiceId,
    price: '7.125',
    list_price: '7.125',
    discount: '0.356',
    net: '6.769',
  });
}

for (const locale of ['ar', 'en'] as const) {
  test(`refuses 7.125 at ten percent in ${locale}`, async ({ page }) => {
    await refuseOdd(page, locale);
  });

  test(`keeps a partial visit and appends the correction in ${locale}`, async ({ page }) => {
    const opened = await openPartial(page, locale);
    const before = await keepRejected(page, locale, opened.customer, opened.date);
    await correctPercent(page, locale, before, opened.customer, opened.date);
  });
}

test('refuses a create when every line is over the limit', async ({ page }) => {
  await refuseAmount(page);
});

async function refusePriceFloor(page: Page): Promise<void> {
  const customer = label('Floor');
  const zone = await openRecorder(page, state, 'en');
  const date = civilDate(zone, 0);
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await fillLine(page, 'en', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    price: '22.000',
    discount: { kind: 'AMOUNT', value: '0.000' },
    performers: [performerAt(state, 0).name],
  });
  const body = await readRefusal(await submitVisit(page, 'en', 'create'));
  expect(body.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(body.details.rejected_lines[0]).toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    price: '22.000',
    discount: '0.000',
    limit_bps: 1000,
  });
  const message = serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT.message_en;
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  await absent(customer, date);
}

test('refuses a 22.000 override on the 25.000 service', async ({ page }) => {
  await refusePriceFloor(page);
});
