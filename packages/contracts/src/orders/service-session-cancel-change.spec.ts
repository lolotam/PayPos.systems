import { expect, it } from 'vitest';
import { recordedServiceLine, serviceLineChanged, serviceSessionRecorded } from './service-session.js';

const id = '01920000-0000-7000-8000-000000004001';
const base = {
  line_id: id, session_id: id, service_id: id, branch_id: id, business_id: id, customer_id: id,
  status: 'ACTIVE', occurred_at: '2026-10-12T10:00:00.000Z', recorded_at: '2026-10-12T10:00:00.000Z',
  business_date: '2026-10-12', late: false, recorded_by: id, recorded_by_membership_id: id,
  list_price: '25.000', price: '25.000', discount: '0.000', net: '25.000',
  performers: [{ employee_id: id, share_bps: 10000 }],
  rule_snapshot: { kind: 'FIXED', value: '2.500' }, counts_snapshot: true, package: null, revision: 2,
};
const previous = { revision: 1, price: '25.000', discount: '0.000', net: '25.000' };
const changeOf = (kind: string) => ({
  kind, changed_at: '2026-10-16T10:00:00.000Z', changed_by: id, changed_by_membership_id: id, previous,
});
const cancelled = { ...base, status: 'CANCELLED', change: changeOf('LINE_CANCELLED') };

it('accepts a cancellation on the next revision with the CANCELLED status', () => {
  const parsed = serviceLineChanged.parse(cancelled);
  expect(parsed.status).toBe('CANCELLED');
  expect(parsed.revision).toBe(previous.revision + 1);
  expect(parsed.change?.kind).toBe('LINE_CANCELLED');
});

it('still accepts the price edit on an ACTIVE line and refuses a cancelled price edit', () => {
  expect(serviceLineChanged.safeParse({ ...base, change: changeOf('PRICE_DISCOUNT_EDIT') }).success).toBe(true);
  expect(
    serviceLineChanged.safeParse({ ...base, status: 'CANCELLED', change: changeOf('PRICE_DISCOUNT_EDIT') }).success,
  ).toBe(false);
});

it('refuses a cancellation that could be read as a price edit or skips a revision', () => {
  for (const candidate of [
    { ...cancelled, status: 'ACTIVE' },
    { ...cancelled, revision: 3 },
    { ...cancelled, revision: 1 },
    { ...cancelled, change: changeOf('LINE_REINSTATED') },
    { ...cancelled, change: { ...changeOf('LINE_CANCELLED'), reason: 'customer complaint' } },
  ])
    expect(serviceLineChanged.safeParse(candidate).success).toBe(false);
});

it('keeps recorded batches free of any change block, cancel included', () => {
  const recordedLine = { ...base, revision: 1 };
  const recorded = {
    schema_version: 1, session_id: id, business_id: id, branch_id: id, customer_id: id,
    occurred_at: base.occurred_at, recorded_at: base.recorded_at, business_date: base.business_date,
    business_timezone: 'Asia/Kuwait', late: false, recorded_by: id, recorded_by_membership_id: id,
    lines: [recordedLine],
  };
  expect(recordedServiceLine.safeParse(recordedLine).success).toBe(true);
  expect(recordedServiceLine.safeParse({ ...recordedLine, change: changeOf('LINE_CANCELLED') }).success).toBe(false);
  expect(
    serviceSessionRecorded.safeParse({ ...recorded, lines: [{ ...recordedLine, change: changeOf('LINE_CANCELLED') }] })
      .success,
  ).toBe(false);
});
