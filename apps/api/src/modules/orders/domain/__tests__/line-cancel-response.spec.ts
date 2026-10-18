import { expect, it } from 'vitest';
import { SessionError } from '../session-error.ts';
import { projectCancelResponse, savedLineCancelResponse } from '../line-cancel-response.ts';
import type { SessionLine, SessionRecord } from '../session-types.ts';

const cancelledAt = new Date('2026-10-17T12:00:00.000Z');

it('returns the full body when the caller can read the visit', () => {
  const built = savedLineCancelResponse(
    visitRecord([visitLine(20000n, 'CANCELLED')]),
    visitLine(20000n, 'CANCELLED').id,
    cancelledAt,
  );
  const projected = projectCancelResponse(true, built.line, built.session);
  expect(projected).toEqual({ line: built.line, session: built.session });
  if (!('line' in projected)) throw new Error('expected the full body');
  expect(projected.line.status).toBe('CANCELLED');
  expect(projected.line.cancelled_at).toBe('2026-10-17T12:00:00.000Z');
  expect(projected.line).not.toHaveProperty('reason');
  expect(projected.line).not.toHaveProperty('cancelled_by');
  expect(projected).not.toHaveProperty('canceller_membership_id');
});

it('returns only the cancel mark when the caller cannot read the visit, replays included', () => {
  const built = savedLineCancelResponse(
    visitRecord([visitLine(20000n, 'CANCELLED')]),
    visitLine(20000n, 'CANCELLED').id,
    cancelledAt,
  );
  const projected = projectCancelResponse(false, built.line, built.session);
  expect(projected).toEqual({ cancelled: true });
  expect(Object.keys(projected)).toEqual(['cancelled']);
  expect(JSON.stringify(projected)).not.toMatch(/reason|canceller|20\.000/);
});

it('sums only active nets and keeps the cancelled line figures', () => {
  const cancelled = visitLine(20000n, 'CANCELLED');
  const active = { ...visitLine(9000n, 'ACTIVE'), id: '01990000-0000-7000-8000-00000000000e' };
  const response = savedLineCancelResponse(
    visitRecord([cancelled, active]),
    cancelled.id,
    cancelledAt,
  );
  expect(response.line.net).toBe('20.000');
  expect(response.line.price).toBe('25.000');
  expect(response.line.discount).toBe('5.000');
  expect(response.session).toEqual({ id: cancelled.session_id, total_net: '9.000' });
});

it('derives a zero total when the cancelled line was the last active one', () => {
  const cancelled = visitLine(20000n, 'CANCELLED');
  const response = savedLineCancelResponse(visitRecord([cancelled]), cancelled.id, cancelledAt);
  expect(response.session.total_net).toBe('0.000');
});

it('refuses a line that is not in the visit', () => {
  const cancelled = visitLine(20000n, 'CANCELLED');
  expect(() =>
    savedLineCancelResponse(
      visitRecord([cancelled]),
      '01990000-0000-7000-8000-00000000000f',
      cancelledAt,
    ),
  ).toThrow(SessionError);
});

function visitLine(net: bigint, status: 'ACTIVE' | 'CANCELLED'): SessionLine {
  return {
    id: '01990000-0000-7000-8000-000000000001',
    session_id: '01990000-0000-7000-8000-000000000002',
    input_index: 0,
    ordinal: 1,
    status,
    revision: 2,
    service: {
      id: '01990000-0000-7000-8000-000000000003',
      name_en: 'Colour',
      name_ar: null,
      price: 25000n,
      rule: { kind: 'FOLLOW_PLAN' },
      counts: true,
      revision: 1,
    },
    price: 25000n,
    discount: 25000n - net,
    net,
    effective_discount_bps: 0,
    limit: { source: 'PERSON', bps: 2000 },
    recorded_by: '01990000-0000-7000-8000-000000000007',
    recorded_by_membership_id: '01990000-0000-7000-8000-000000000008',
    recorded_at: new Date('2026-10-15T08:00:00.000Z'),
    late: false,
    has_performer_warning: false,
    explicit_unequal_shares: false,
    performer_ids: ['01990000-0000-7000-8000-00000000000c'],
    performers: [
      {
        employee: {
          id: '01990000-0000-7000-8000-00000000000b',
          name_en: 'Noura',
          name_ar: null,
          user_id: null,
          eligible: true,
          clocked_in: true,
          approved_leave: false,
        },
        share_bps: 10000,
        not_clocked_in_warning: false,
        approved_leave_warning: false,
      },
    ],
  };
}

function visitRecord(lines: SessionLine[]): SessionRecord {
  const line = lines[0] as SessionLine;
  return {
    id: line.session_id,
    business_id: '01990000-0000-7000-8000-000000000005',
    branch_id: '01990000-0000-7000-8000-000000000004',
    customer: { id: '01990000-0000-7000-8000-000000000006', name: 'Customer', phone_masked: '***' },
    recorded_by: line.recorded_by,
    recorded_by_membership_id: line.recorded_by_membership_id,
    occurred_at: line.recorded_at,
    recorded_at: line.recorded_at,
    business_date: '2026-10-14',
    business_timezone: 'Asia/Kuwait',
    late: false,
    lines,
  };
}
