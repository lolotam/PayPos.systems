import { expect, it } from 'vitest';
import {
  changeLinePerformersInput,
  changeLinePerformersResponse,
  changeLinePerformersResponseFull,
  changeLinePerformersResponseNarrow,
  recordedServiceLine,
  savedServiceLine,
  serviceLineChanged,
  serviceSessionRecorded,
} from './service-session.js';

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

it('accepts four previous performers and refuses the performers shape on the two older kinds', () => {
  const four = Array.from({ length: 4 }, () => ({ employee_id: id, share_bps: 2500 }));
  expect(
    serviceLineChanged.safeParse({
      ...base,
      change: changeOf('PERFORMERS_CHANGE', { revision: 1, performers: four }),
    }).success,
  ).toBe(true);
  for (const candidate of [
    { ...base, change: changeOf('PRICE_DISCOUNT_EDIT', performersPrevious) },
    { ...base, status: 'CANCELLED', change: changeOf('LINE_CANCELLED', performersPrevious) },
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

const performer = {
  id, employee_id: id, performer_ordinal: 1, share_bps: 10000, name_en: 'Mona', name_ar: null,
  not_clocked_in_warning: false, approved_leave_warning: false,
};
const savedLine = {
  id, session_id: id, service_id: id, input_index: 0, ordinal: 1, name_en: 'Colour', name_ar: null,
  list_price: '25.000', price: '25.000', discount: '2.500', net: '22.500', effective_discount_bps: 1000,
  limit_bps_applied: 1000, limit_source: 'PERSON' as const, status: 'ACTIVE' as const, revision: 1,
  rule_snapshot: { kind: 'ZERO' as const }, counts_snapshot: true, catalog_revision: 1, has_performer_warning: false,
  performers: [performer], recorded_by: id, recorded_by_membership_id: id, recorded_at: '2026-10-12T10:00:00.000Z', late: false,
};
const session = { id, total_net: '22.500' };

it('accepts a performers-change body and leaves the missing reason to the domain', () => {
  const parsed = changeLinePerformersInput.parse({
    performers: [{ employee_id: id, share_bps: 7000 }, { employee_id: id }],
    expected_revision: 1,
    changer_membership_id: id,
  });
  expect(parsed.performers).toHaveLength(2);
  expect(parsed).not.toHaveProperty('reason');
  expect(
    changeLinePerformersInput.safeParse({ performers: [{ employee_id: id }], expected_revision: 1, reason: '' }).success,
  ).toBe(true);
});

it('leaves the performer-set shape to the domain so an invalid set is a 422, not a 400', () => {
  expect(changeLinePerformersInput.safeParse({ performers: [], expected_revision: 1 }).success).toBe(true);
  expect(
    changeLinePerformersInput.safeParse({
      performers: Array.from({ length: 5 }, () => ({ employee_id: id })),
      expected_revision: 1,
    }).success,
  ).toBe(true);
  expect(
    changeLinePerformersInput.safeParse({
      performers: [{ employee_id: id }, { employee_id: id }],
      expected_revision: 1,
    }).success,
  ).toBe(true);
});

it('refuses an unknown key and a revision below one', () => {
  expect(
    changeLinePerformersInput.safeParse({ performers: [{ employee_id: id }], expected_revision: 1, status: 'ACTIVE' }).success,
  ).toBe(false);
  expect(
    changeLinePerformersInput.safeParse({ performers: [{ employee_id: id }], expected_revision: 0 }).success,
  ).toBe(false);
});

it('publishes the full body with the mark date and the narrow body with the mark alone', () => {
  const full = { line: { ...savedLine, performers_changed_at: '2026-10-20' }, session };
  const parsed = changeLinePerformersResponseFull.parse(full);
  expect(parsed.line.status).toBe('ACTIVE');
  expect(parsed.line.performers_changed_at).toBe('2026-10-20');
  expect(changeLinePerformersResponse.parse(full)).toEqual(full);
  expect(changeLinePerformersResponseNarrow.parse({ changed: true })).toEqual({ changed: true });
  expect(changeLinePerformersResponse.parse({ changed: true })).toEqual({ changed: true });
});

it('refuses a cancelled line or a missing mark date on the full body', () => {
  expect(
    changeLinePerformersResponseFull.safeParse({
      line: { ...savedLine, status: 'CANCELLED', performers_changed_at: '2026-10-20' },
      session,
    }).success,
  ).toBe(false);
  expect(changeLinePerformersResponseFull.safeParse({ line: savedLine, session }).success).toBe(false);
});

it('keeps the mark date off a line whose performers never changed', () => {
  expect(Object.hasOwn(savedServiceLine.parse(savedLine), 'performers_changed_at')).toBe(false);
  expect(savedServiceLine.parse({ ...savedLine, performers_changed_at: '2026-10-20' }).performers_changed_at).toBe('2026-10-20');
  expect(savedServiceLine.safeParse({ ...savedLine, performers_changed_at: '2026-10-20T00:00:00Z' }).success).toBe(false);
  expect(savedServiceLine.safeParse({ ...savedLine, performers_changed_at: '20-10-2026' }).success).toBe(false);
});
