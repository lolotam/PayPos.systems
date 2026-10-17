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
const moneyPrevious = { revision: 1, price: '25.000', discount: '0.000', net: '25.000' };
const performersPrevious = { revision: 1, performers: [{ employee_id: id, share_bps: 10000 }] };
const changeOf = (kind: string, previous: object = moneyPrevious) => ({
  kind, changed_at: '2026-10-16T10:00:00.000Z', changed_by: id, changed_by_membership_id: id, previous,
});
const performersChange = { ...base, change: changeOf('PERFORMERS_CHANGE', performersPrevious) };

it('accepts a performers change on an ACTIVE line at the next revision', () => {
  const parsed = serviceLineChanged.parse(performersChange);
  expect(parsed.status).toBe('ACTIVE');
  expect(parsed.revision).toBe(performersPrevious.revision + 1);
  expect(parsed.change?.kind).toBe('PERFORMERS_CHANGE');
});

it('keeps the price edit and the cancellation passing', () => {
  expect(serviceLineChanged.safeParse({ ...base, change: changeOf('PRICE_DISCOUNT_EDIT') }).success).toBe(true);
  expect(
    serviceLineChanged.safeParse({ ...base, status: 'CANCELLED', change: changeOf('LINE_CANCELLED') }).success,
  ).toBe(true);
});

it('refuses a cancelled status, a wrong revision, a reason, price fields, or 0 or 5 performers', () => {
  const five = Array.from({ length: 5 }, () => ({ employee_id: id, share_bps: 2000 }));
  for (const candidate of [
    { ...performersChange, status: 'CANCELLED' },
    { ...performersChange, revision: 3 },
    { ...performersChange, revision: 1 },
    { ...performersChange, change: { ...changeOf('PERFORMERS_CHANGE', performersPrevious), reason: 'wrong split' } },
    { ...performersChange, change: changeOf('PERFORMERS_CHANGE', moneyPrevious) },
    { ...performersChange, change: changeOf('PERFORMERS_CHANGE', { revision: 1, performers: [] }) },
    { ...performersChange, change: changeOf('PERFORMERS_CHANGE', { revision: 1, performers: five }) },
  ])
    expect(serviceLineChanged.safeParse(candidate).success).toBe(false);
});

it('keeps recorded batches free of any change block', () => {
  const recordedLine = { ...base, revision: 1 };
  const recorded = {
    schema_version: 1, session_id: id, business_id: id, branch_id: id, customer_id: id,
    occurred_at: base.occurred_at, recorded_at: base.recorded_at, business_date: base.business_date,
    business_timezone: 'Asia/Kuwait', late: false, recorded_by: id, recorded_by_membership_id: id,
    lines: [recordedLine],
  };
  expect(recordedServiceLine.safeParse(recordedLine).success).toBe(true);
  expect(recordedServiceLine.safeParse({ ...recordedLine, change: changeOf('PERFORMERS_CHANGE', performersPrevious) }).success).toBe(false);
  expect(
    serviceSessionRecorded.safeParse({
      ...recorded,
      lines: [{ ...recordedLine, change: changeOf('PERFORMERS_CHANGE', performersPrevious) }],
    }).success,
  ).toBe(false);
});
