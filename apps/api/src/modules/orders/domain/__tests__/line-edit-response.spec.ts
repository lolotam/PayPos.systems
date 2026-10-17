import { expect, it } from 'vitest';
import { SessionError } from '../session-error.ts';
import { projectEditResponse, savedLineEditResponse } from '../line-edit-response.ts';
import type { SessionLine, SessionRecord } from '../session-types.ts';

const full = {
  line: { edited: true as const, price: '20.000', discount: '5.000', net: '20.000', revision: 2 },
  session: { id: 'session', total_net: '20.000' },
};

it('returns the full body unchanged when the caller can read the visit', () => {
  expect(projectEditResponse(full, true)).toBe(full);
});

it('returns only the saved mark when the caller cannot read the visit', () => {
  const projected = projectEditResponse(full, false);
  expect(projected).toEqual({ saved: true, edited: true });
  expect(Object.keys(projected).sort()).toEqual(['edited', 'saved']);
  expect(full.line.price).toBe('20.000');
});

it('sums only active nets and marks the saved line edited', () => {
  const active = visitLine(20000n, 'ACTIVE');
  const cancelled = { ...visitLine(9000n, 'CANCELLED'), id: '01990000-0000-7000-8000-00000000000e' };
  const response = savedLineEditResponse(visitRecord([active, cancelled]), active.id);
  expect(response.line.edited).toBe(true);
  expect(response.line.net).toBe('20.000');
  expect(response.session).toEqual({ id: active.session_id, total_net: '20.000' });
  expect(() => savedLineEditResponse(visitRecord([active]), '01990000-0000-7000-8000-00000000000f')).toThrow(SessionError);
});

function visitLine(net: bigint, status: 'ACTIVE' | 'CANCELLED'): SessionLine {
  return {
    id: '01990000-0000-7000-8000-000000000001', session_id: '01990000-0000-7000-8000-000000000002', input_index: 0, ordinal: 1,
    status, revision: 2, service: { id: '01990000-0000-7000-8000-000000000003', name_en: 'Colour', name_ar: null, price: 25000n, rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1 },
    price: 25000n, discount: 25000n - net, net, effective_discount_bps: 0, limit: { source: 'PERSON', bps: 2000 },
    recorded_by: '01990000-0000-7000-8000-000000000007', recorded_by_membership_id: '01990000-0000-7000-8000-000000000008',
    recorded_at: new Date('2026-10-15T08:00:00.000Z'), late: false, has_performer_warning: false, explicit_unequal_shares: false,
    performer_ids: ['01990000-0000-7000-8000-00000000000c'],
    performers: [{ employee: { id: '01990000-0000-7000-8000-00000000000b', name_en: 'Noura', name_ar: null, user_id: null, eligible: true, clocked_in: true, approved_leave: false }, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }],
  };
}

function visitRecord(lines: SessionLine[]): SessionRecord {
  const line = lines[0] as SessionLine;
  return {
    id: line.session_id, business_id: '01990000-0000-7000-8000-000000000005', branch_id: '01990000-0000-7000-8000-000000000004',
    customer: { id: '01990000-0000-7000-8000-000000000006', name: 'Customer', phone_masked: '***' },
    recorded_by: line.recorded_by, recorded_by_membership_id: line.recorded_by_membership_id, occurred_at: line.recorded_at, recorded_at: line.recorded_at,
    business_date: '2026-10-14', business_timezone: 'Asia/Kuwait', late: false, lines,
  };
}
