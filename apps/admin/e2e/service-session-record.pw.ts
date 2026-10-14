import { expect, test, type Page } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

import {
  civilDate,
  findOrCreateCustomer,
  fillLine,
  label,
  loadState,
  nationalNumber,
  openRecorder,
  performerAt,
  readRecorded,
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
  const zone = await openRecorder(page, state, locale);
  await findOrCreateCustomer(page, locale, customer, nationalNumber());
  await fillLine(page, locale, 0, amountSpec());
  const body = await readRecorded(await submitVisit(page, locale, 'create'));
  expect(body.outcome).toBe('COMPLETE');
  expect(body.session.business_timezone).toBe(zone);
  expect(body.session.lines).toHaveLength(1);
  await expect(page.getByRole('status').filter({ hasText: t(locale, 'serviceSessions.saved') }).first()).toBeVisible();
  const visit = await savedVisit(state, customer, body.session.business_date);
  expect(visit.late).toBe(false);
  expect(visit.lines).toHaveLength(1);
  expectShares(visit.lines[0], {
    service_id: state.standardServiceId,
    price: '25.000',
    list_price: '25.000',
    discount: '1.000',
    net: '24.000',
    late: false,
  }, [10_000]);
}

async function recordLate(page: Page): Promise<{ customer: string; visit: DayVisit; date: string }> {
  const customer = label('Late');
  const zone = await openRecorder(page, state, 'en');
  const yesterday = civilDate(zone, -1);
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await setOccurredAt(page, 'en', `${yesterday}T15:00`);
  await fillLine(page, 'en', 0, {
    serviceName: state.standardServiceName,
    catalogPrice: '25.000',
    discount: { kind: 'PERCENT', value: '5' },
    performers: [0, 1, 2, 3].map((index) => performerAt(state, index).name),
  });
  await expect(page.getByText(t('en', 'serviceSessions.notClockedIn')).first()).toBeVisible();
  const body = await readRecorded(await submitVisit(page, 'en', 'create'));
  expect(body.session.business_date).toBe(yesterday);
  expect(body.session.business_timezone).toBe(zone);
  await expect(page.getByText(t('en', 'serviceSessions.late')).first()).toBeVisible();
  const visit = await savedVisit(state, customer, body.session.business_date);
  expect(visit.late).toBe(true);
  expect(visit.lines).toHaveLength(1);
  expectShares(visit.lines[0], { price: '25.000', list_price: '25.000', discount: '1.250', net: '23.750', late: true }, [
    2500, 2500, 2500, 2500,
  ]);
  return { customer, visit, date: body.session.business_date };
}

async function appendLate(page: Page, customer: string, before: DayVisit, date: string): Promise<void> {
  await fillLine(page, 'en', 0, amountSpec());
  const body = await readRecorded(await submitVisit(page, 'en', 'append'));
  expect(body.session.business_date).toBe(date);
  const after = await savedVisit(state, customer, date);
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
    shares: ['10', '20', '30', '40'],
  });
  const body = await readRecorded(await submitVisit(page, 'ar', 'create'));
  const visit = await savedVisit(state, customer, body.session.business_date);
  expect(visit.lines).toHaveLength(1);
  expectShares(
    visit.lines[0],
    { price: '24.000', list_price: '25.000', discount: '1.000', net: '23.000', late: false },
    [1000, 2000, 3000, 4000],
  );
}

for (const locale of ['ar', 'en'] as const) {
  test(`saves an amount discount in ${locale}`, async ({ page }) => {
    await saveAmount(page, locale);
  });
}

test('saves a late equal split and appends without moving the header', async ({ page }) => {
  const saved = await recordLate(page);
  await appendLate(page, saved.customer, saved.visit, saved.date);
});

test('saves a price override with four custom shares in Arabic', async ({ page }) => {
  await recordOverride(page);
});

test('saves under the membership the recorder chooses', async ({ page }) => {
  const customer = label('Member');
  await openRecorder(page, state, 'en');
  const membership = page.getByLabel(t('en', 'serviceSessions.recorderMembership'), { exact: true });
  await expect(membership.locator(`option[value="${state.recorderMembershipId}"]`)).toHaveCount(1);
  await expect(membership.locator(`option[value="${state.narrowMembershipId}"]`)).toHaveCount(1);
  await membership.selectOption(state.narrowMembershipId);
  await expect(page.getByText('5.00%').first()).toBeVisible();
  await expect(page.getByText('10.00%')).toHaveCount(0);
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await fillLine(page, 'en', 0, amountSpec());
  const body = await readRecorded(await submitVisit(page, 'en', 'create'));
  expect(body.session.recorded_by_membership_id).toBe(state.narrowMembershipId);
  expect(body.session.lines).toHaveLength(1);
  expect(body.session.lines[0]?.recorded_by_membership_id).toBe(state.narrowMembershipId);
  expect(body.session.lines[0]).toMatchObject({ limit_bps_applied: 500, limit_source: 'PERSON' });
});

test('saves while the performer is on approved leave', async ({ page }) => {
  const customer = label('Leave');
  const onLeave = performerAt(state, 0);
  const working = performerAt(state, 1);
  const zone = await openRecorder(page, state, 'en');
  await findOrCreateCustomer(page, 'en', customer, nationalNumber());
  await fillLine(page, 'en', 0, {
    ...amountSpec(),
    performers: [onLeave.name, working.name],
  });
  await expect(page.getByText(t('en', 'serviceSessions.approvedLeave')).first()).toBeVisible();
  const body = await readRecorded(await submitVisit(page, 'en', 'create'));
  expect(body.outcome).toBe('COMPLETE');
  expect(body.session.business_timezone).toBe(zone);
  const performers = body.session.lines[0]?.performers;
  expect(performers?.find((person) => person.employee_id === onLeave.id)?.approved_leave_warning).toBe(true);
  expect(performers?.find((person) => person.employee_id === working.id)?.approved_leave_warning).toBe(false);
  const visit = await savedVisit(state, customer, body.session.business_date);
  expect(visit.lines).toHaveLength(1);
  expect(visit.lines[0]?.performers.find((person) => person.employee_id === onLeave.id)?.approved_leave_warning).toBe(true);
  expect(visit.lines[0]?.performers.find((person) => person.employee_id === working.id)?.approved_leave_warning).toBe(false);
});

test.describe('narrow Arabic keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('submits a visit with Enter while the document is RTL', async ({ page }) => {
    const customer = label('Keys');
    await openRecorder(page, state, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await findOrCreateCustomer(page, 'ar', customer, nationalNumber());
    await fillLine(page, 'ar', 0, amountSpec());
    const body = await readRecorded(await submitVisit(page, 'ar', 'create', true));
    const visit = await savedVisit(state, customer, body.session.business_date);
    expect(visit.lines).toHaveLength(1);
  });
});
