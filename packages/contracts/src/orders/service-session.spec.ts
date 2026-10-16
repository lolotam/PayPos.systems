import { expect, it } from 'vitest';
import { appendServiceSessionLinesInput, recordServiceSessionInput, recordedServiceLine, serviceLineChanged, serviceSessionLinesAdded, serviceSessionRecorded, sessionMoney } from './service-session.js';
const id = '01920000-0000-7000-8000-000000004001';
const other = '01920000-0000-7000-8000-000000004002';
const line = { service_id: id, price: '7.125', discount: { kind: 'PERCENT', bps: 1000 }, performers: [{ employee_id: id }] };
it('accepts both discounts, omitted time/selection and equal or explicit performer shares', () => {
  expect(recordServiceSessionInput.parse({ customer_id: id, lines: [line] })).not.toHaveProperty('occurred_at');
  expect(recordServiceSessionInput.safeParse({ customer_id: id, recorder_membership_id: id, occurred_at: '2026-10-12T10:00:00.000Z', lines: [
    { ...line, discount: { kind: 'AMOUNT', amount: '0.713' }, performers: [{ employee_id: id, share_bps: 7000 }, { employee_id: other, share_bps: 3000 }] }] }).success).toBe(true);
});
it('canonicalizes UUID case before identity comparisons and actor-bound fingerprinting', () => {
  const value = '01920000-ABCD-7000-8000-000000004001';
  const parsed = recordServiceSessionInput.parse({ customer_id: value, recorder_membership_id: value,
    lines: [{ ...line, service_id: value, performers: [{ employee_id: value }] }] });
  expect(parsed.customer_id).toBe(value.toLowerCase()); expect(parsed.recorder_membership_id).toBe(value.toLowerCase());
  expect(parsed.lines[0]?.service_id).toBe(value.toLowerCase()); expect(parsed.lines[0]?.performers[0]?.employee_id).toBe(value.toLowerCase());
});
it.each(['-1.000','1.00','01.000','100000000000.000','1e3','Infinity'])('rejects noncanonical money %s', (price) => expect(sessionMoney.safeParse(price).success).toBe(false));
it.each([{ company_id: id }, { actorUserId: id }, { late: true }, { status: 'ACTIVE' }, { limit_bps: 10000 }])('rejects client authority/snapshot fields %#', (extra) => expect(recordServiceSessionInput.safeParse({ customer_id: id, lines: [line], ...extra }).success).toBe(false));
it.each([
  [], Array.from({ length: 5 }, () => ({ employee_id: id })),
  [{ employee_id: id }, { employee_id: id }],
  [{ employee_id: id, share_bps: 5000 }, { employee_id: other }],
  ...[0, 1.5, 9999, -1, 10001].map((share_bps) => [{ employee_id: id, share_bps }]),
].map((performers) => ({ performers })))('leaves SS-20 business validation to the domain for indexed 422 errors %#', ({ performers }) => {
  const lines = [{ ...line, performers }];
  expect(recordServiceSessionInput.safeParse({ customer_id: id, lines }).success).toBe(true);
  expect(appendServiceSessionLinesInput.safeParse({ lines }).success).toBe(true);
});
it.each([undefined, null, {}, [{ employee_id: 'invalid' }], [{ employee_id: id, share_bps: '10000' }], [{ employee_id: id, share_bps: null }], [{ employee_id: id, extra: true }]])('rejects performer shape/type errors %#', (performers) => {
  const lines = [{ ...line, performers }];
  expect(recordServiceSessionInput.safeParse({ customer_id: id, lines }).success).toBe(false);
  expect(appendServiceSessionLinesInput.safeParse({ lines }).success).toBe(false);
});
it('leaves discount money arithmetic to the domain', () => {
  expect(recordServiceSessionInput.safeParse({ customer_id: id, lines: [{ ...line, price: '0.000', discount: { kind: 'AMOUNT', amount: '1.000' } }] }).success).toBe(true);
});
it('append cannot change customer, original time or visit header and shares the 20-line request bound', () => {
  expect(appendServiceSessionLinesInput.safeParse({ lines: [line] }).success).toBe(true);
  for (const extra of [{ customer_id: id }, { occurred_at: '2026-10-12T10:00:00Z' }, { business_date: '2026-10-12' }])
    expect(appendServiceSessionLinesInput.safeParse({ lines: [line], ...extra }).success).toBe(false);
  expect(appendServiceSessionLinesInput.safeParse({ lines: Array.from({ length: 21 }, () => line) }).success).toBe(false);
});
it('batch snapshots are ACTIVE revision one; later changed-line snapshots may be CANCELLED at a higher revision', () => {
  const saved = { line_id: id, session_id: id, service_id: id, branch_id: id, business_id: id, customer_id: id,
    status: 'ACTIVE', occurred_at: '2026-10-12T10:00:00.000Z', recorded_at: '2026-10-12T10:00:00.000Z', business_date: '2026-10-12',
    late: false, recorded_by: id, recorded_by_membership_id: id, list_price: '25.000', price: '25.000', discount: '0.000', net: '25.000',
    performers: [{ employee_id: id, share_bps: 10000 }], rule_snapshot: { kind: 'FIXED', value: '2.500' }, counts_snapshot: true, package: null, revision: 1 };
  expect(recordedServiceLine.safeParse(saved).success).toBe(true);
  expect(recordedServiceLine.safeParse({ ...saved, status: 'CANCELLED' }).success).toBe(false);
  expect(recordedServiceLine.safeParse({ ...saved, revision: 2 }).success).toBe(false);
  expect(serviceLineChanged.safeParse({ ...saved, status: 'CANCELLED', revision: 2 }).success).toBe(true);
});
const priceEdit = {
  kind: 'PRICE_DISCOUNT_EDIT',
  changed_at: '2026-10-16T10:00:00.000Z',
  changed_by: id,
  changed_by_membership_id: id,
  previous: { revision: 1, price: '25.000', discount: '0.000', net: '25.000' },
};
const editedLine = {
  line_id: id, session_id: id, service_id: id, branch_id: id, business_id: id, customer_id: id,
  status: 'ACTIVE', occurred_at: '2026-10-16T10:00:00.000Z', recorded_at: '2026-10-12T10:00:00.000Z',
  business_date: '2026-10-12', late: false, recorded_by: id, recorded_by_membership_id: id,
  list_price: '25.000', price: '20.000', discount: '5.000', net: '20.000',
  performers: [{ employee_id: id, share_bps: 10000 }], rule_snapshot: { kind: 'FIXED', value: '2.500' },
  counts_snapshot: true, package: null, revision: 2, change: priceEdit,
};
it('accepts a price or discount edit on the next active revision', () => {
  expect(serviceLineChanged.parse(editedLine).revision).toBe(2);
});
it('rejects a malformed price edit', () => {
  const withoutEditor = Object.fromEntries(Object.entries(priceEdit).filter(([key]) => key !== 'changed_by'));
  for (const candidate of [
    { ...editedLine, change: { ...priceEdit, kind: 'CANCEL' } },
    { ...editedLine, change: { ...priceEdit, note: 'extra' } },
    { ...editedLine, revision: 3 },
    { ...editedLine, status: 'CANCELLED' },
    { ...editedLine, change: { ...priceEdit, previous: { ...priceEdit.previous, net: '2.5' } } },
    { ...editedLine, change: { ...priceEdit, previous: { ...priceEdit.previous, price: '1250' } } },
    { ...editedLine, change: { ...priceEdit, previous: { ...priceEdit.previous, discount: '1250.0000' } } },
    { ...editedLine, change: { ...priceEdit, previous: { ...priceEdit.previous, net: '-1.000' } } },
    { ...editedLine, change: { ...priceEdit, previous: { ...priceEdit.previous, price: '01.000' } } },
    { ...editedLine, change: withoutEditor },
    { ...editedLine, change: null },
  ]) expect(serviceLineChanged.safeParse(candidate).success).toBe(false);
});
it('recorded batches stay without a change block', () => {
  const saved = {
    line_id: id, session_id: id, service_id: id, branch_id: id, business_id: id, customer_id: id,
    status: 'ACTIVE', occurred_at: '2026-10-12T10:00:00.000Z', recorded_at: '2026-10-12T10:00:00.000Z',
    business_date: '2026-10-12', late: false, recorded_by: id, recorded_by_membership_id: id,
    list_price: '25.000', price: '25.000', discount: '0.000', net: '25.000',
    performers: [{ employee_id: id, share_bps: 10000 }], rule_snapshot: { kind: 'FIXED', value: '2.500' },
    counts_snapshot: true, package: null, revision: 1,
  };
  const recorded = {
    schema_version: 1, session_id: id, business_id: id, branch_id: id, customer_id: id,
    occurred_at: saved.occurred_at, recorded_at: saved.recorded_at, business_date: saved.business_date,
    business_timezone: 'Asia/Kuwait', late: false, recorded_by: id, recorded_by_membership_id: id,
    lines: [saved],
  };
  expect(recordedServiceLine.safeParse(saved).success).toBe(true);
  expect(recordedServiceLine.safeParse({ ...saved, change: priceEdit }).success).toBe(false);
  expect(recordedServiceLine.safeParse({ ...saved, extra: true }).success).toBe(false);
  expect(serviceSessionRecorded.safeParse(recorded).success).toBe(true);
  expect(serviceSessionLinesAdded.safeParse(recorded).success).toBe(true);
  expect(serviceSessionRecorded.safeParse({ ...recorded, lines: [{ ...saved, change: priceEdit }] }).success).toBe(false);
  expect(serviceSessionLinesAdded.safeParse({ ...recorded, lines: [{ ...saved, change: priceEdit }] }).success).toBe(false);
});
