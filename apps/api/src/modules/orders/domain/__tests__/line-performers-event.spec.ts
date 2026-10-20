import { serviceLineChanged } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { linePerformersEvent } from '../line-performers-event.ts';
import type { SessionLine, SessionRecord } from '../session-types.ts';

const at = new Date('2026-10-15T08:00:00.000Z');
const recorder = '01990000-0000-7000-8000-000000000007';
const changer = '01990000-0000-7000-8000-000000000009';

function sample(): { record: SessionRecord; line: SessionLine } {
  const line: SessionLine = {
    id: '01990000-0000-7000-8000-000000000001', session_id: '01990000-0000-7000-8000-000000000002', input_index: 0, ordinal: 1,
    status: 'ACTIVE', revision: 2, service: { id: '01990000-0000-7000-8000-000000000003', name_en: 'Noura Colour', name_ar: null, price: 25000n, rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1 },
    price: 25000n, discount: 0n, net: 25000n, effective_discount_bps: 0, limit: { source: 'PERSON', bps: 2000 },
    recorded_by: recorder, recorded_by_membership_id: '01990000-0000-7000-8000-000000000008', recorded_at: at, late: false,
    has_performer_warning: false, explicit_unequal_shares: false, performer_ids: ['01990000-0000-7000-8000-00000000000e', '01990000-0000-7000-8000-00000000000b'],
    performers: [
      { employee: { id: '01990000-0000-7000-8000-00000000000c', name_en: 'Rana', name_ar: 'رنا', user_id: null, eligible: true, clocked_in: true, approved_leave: false }, share_bps: 6000, not_clocked_in_warning: false, approved_leave_warning: false },
      { employee: { id: '01990000-0000-7000-8000-00000000000b', name_en: 'Noura', name_ar: 'نورة', user_id: null, eligible: true, clocked_in: true, approved_leave: false }, share_bps: 4000, not_clocked_in_warning: false, approved_leave_warning: false },
    ],
  };
  const record: SessionRecord = {
    id: line.session_id, business_id: '01990000-0000-7000-8000-000000000005', branch_id: '01990000-0000-7000-8000-000000000004',
    customer: { id: '01990000-0000-7000-8000-000000000006', name: 'Customer', phone_masked: 'PHONE-SENTINEL' },
    recorded_by: recorder, recorded_by_membership_id: line.recorded_by_membership_id, occurred_at: at, recorded_at: at,
    business_date: '2026-10-14', business_timezone: 'Asia/Kuwait', late: false, lines: [line],
  };
  return { record, line };
}

it('builds a performers change event at the next revision and omits the reason, names, and phone', () => {
  const { record, line } = sample();
  const payload = linePerformersEvent({
    record, line,
    previous: { revision: 1, performers: [{ employee_id: '01990000-0000-7000-8000-00000000000b', share_bps: 10000 }] },
    changer: { userId: changer, membershipId: '01990000-0000-7000-8000-00000000000a', at },
  });
  expect(serviceLineChanged.parse(payload)).toEqual(payload);
  expect(payload.revision).toBe(2);
  expect(payload.status).toBe('ACTIVE');
  expect(payload.change.kind).toBe('PERFORMERS_CHANGE');
  expect(payload.recorded_by).toBe(recorder);
  expect(payload.change.changed_by).toBe(changer);
  expect(payload.change.previous).toEqual({
    revision: 1,
    performers: [{ employee_id: '01990000-0000-7000-8000-00000000000b', share_bps: 10000 }],
  });
  const text = JSON.stringify(payload);
  expect(text).not.toContain('reason');
  expect(text).not.toContain('PHONE-SENTINEL');
  expect(text).not.toContain('Noura');
  expect(text).not.toContain('نورة');
});

it('keeps the saved order of the performers instead of sorting them by employee id', () => {
  const { record, line } = sample();
  const payload = linePerformersEvent({
    record, line,
    previous: { revision: 1, performers: [{ employee_id: '01990000-0000-7000-8000-00000000000b', share_bps: 10000 }] },
    changer: { userId: changer, membershipId: '01990000-0000-7000-8000-00000000000a', at },
  });
  expect(payload.performers.map((row) => row.employee_id)).toEqual([
    '01990000-0000-7000-8000-00000000000c',
    '01990000-0000-7000-8000-00000000000b',
  ]);
});

it('keeps the given order of the previous performers', () => {
  const { record, line } = sample();
  const previous = [
    { employee_id: '01990000-0000-7000-8000-00000000000e', share_bps: 3000 },
    { employee_id: '01990000-0000-7000-8000-00000000000d', share_bps: 7000 },
  ];
  const payload = linePerformersEvent({
    record, line, previous: { revision: 1, performers: previous },
    changer: { userId: changer, membershipId: '01990000-0000-7000-8000-00000000000a', at },
  });
  expect(payload.change.previous.performers).toEqual(previous);
});
