import { serviceLineChanged } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { lineCancelEvent } from '../line-cancel-event.ts';
import type { SessionLine, SessionRecord } from '../session-types.ts';

const at = new Date('2026-10-15T08:00:00.000Z');
const recorder = '01990000-0000-7000-8000-000000000007';
const canceller = '01990000-0000-7000-8000-000000000009';

function sample(): { record: SessionRecord; line: SessionLine } {
  const line: SessionLine = {
    id: '01990000-0000-7000-8000-000000000001', session_id: '01990000-0000-7000-8000-000000000002', input_index: 0, ordinal: 1,
    status: 'CANCELLED', revision: 2, service: { id: '01990000-0000-7000-8000-000000000003', name_en: 'Noura Colour', name_ar: null, price: 25000n, rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1 },
    price: 25000n, discount: 0n, net: 25000n, effective_discount_bps: 0, limit: { source: 'PERSON', bps: 2000 },
    recorded_by: recorder, recorded_by_membership_id: '01990000-0000-7000-8000-000000000008', recorded_at: at, late: false,
    has_performer_warning: false, explicit_unequal_shares: false, performer_ids: ['01990000-0000-7000-8000-00000000000c'],
    performers: [{ employee: { id: '01990000-0000-7000-8000-00000000000b', name_en: 'Noura', name_ar: 'نورة', user_id: null, eligible: true, clocked_in: true, approved_leave: false }, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }],
  };
  const record: SessionRecord = {
    id: line.session_id, business_id: '01990000-0000-7000-8000-000000000005', branch_id: '01990000-0000-7000-8000-000000000004',
    customer: { id: '01990000-0000-7000-8000-000000000006', name: 'Customer', phone_masked: 'PHONE-SENTINEL' },
    recorded_by: recorder, recorded_by_membership_id: line.recorded_by_membership_id, occurred_at: at, recorded_at: at,
    business_date: '2026-10-14', business_timezone: 'Asia/Kuwait', late: false, lines: [line],
  };
  return { record, line };
}

it('builds a cancel event at the next revision and omits the reason, names, and phone', () => {
  const { record, line } = sample();
  const payload = lineCancelEvent({
    record, line, previous: { revision: 1, price: 25000n, discount: 0n, net: 25000n },
    canceller: { userId: canceller, membershipId: '01990000-0000-7000-8000-00000000000a', at },
  });
  expect(serviceLineChanged.parse(payload)).toEqual(payload);
  expect(payload.revision).toBe(2);
  expect(payload.status).toBe('CANCELLED');
  expect(payload.change.kind).toBe('LINE_CANCELLED');
  expect(payload.recorded_by).toBe(recorder);
  expect(payload.change.changed_by).toBe(canceller);
  expect(payload.change.previous).toEqual({ revision: 1, price: '25.000', discount: '0.000', net: '25.000' });
  const text = JSON.stringify(payload);
  expect(text).not.toContain('reason');
  expect(text).not.toContain('PHONE-SENTINEL');
  expect(text).not.toContain('Noura');
  expect(text).not.toContain('نورة');
});
