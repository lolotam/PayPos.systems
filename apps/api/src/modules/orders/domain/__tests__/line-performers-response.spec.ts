import { expect, it } from 'vitest';
import {
  performersChangedMark,
  projectPerformersChangeResponse,
  savedLinePerformersChangeResponse,
} from '../line-performers-response.ts';
import { SessionError } from '../session-error.ts';
import type { SessionLine, SessionRecord } from '../session-types.ts';

it('returns the full body when the caller can read the visit', () => {
  const line = visitLine(20000n, 'ACTIVE');
  const built = savedLinePerformersChangeResponse(visitRecord([line]), line.id, '2026-10-20', false);
  const projected = projectPerformersChangeResponse(true, built.line, built.session);
  expect(projected).toEqual({ line: built.line, session: built.session });
  if (!('line' in projected)) throw new Error('expected the full body');
  expect(projected.line.status).toBe('ACTIVE');
  expect(projected.line.performers_changed_at).toBe('2026-10-20');
  expect(projected.line).not.toHaveProperty('reason');
  expect(projected).not.toHaveProperty('changer_membership_id');
});

it('PC-02 keeps the price-edit mark of a line whose price was edited before', () => {
  const line = visitLine(20000n, 'ACTIVE');
  const built = savedLinePerformersChangeResponse(visitRecord([line]), line.id, '2026-10-20', true);
  expect(built.line.edited).toBe(true);
});

it('PC-02 leaves the price-edit mark absent on a line whose price was never edited', () => {
  const line = visitLine(20000n, 'ACTIVE');
  const built = savedLinePerformersChangeResponse(visitRecord([line]), line.id, '2026-10-20', false);
  expect(Object.hasOwn(built.line, 'edited')).toBe(false);
});

it('returns only the change mark when the caller cannot read the visit, replays included', () => {
  const line = visitLine(20000n, 'ACTIVE');
  const built = savedLinePerformersChangeResponse(visitRecord([line]), line.id, '2026-10-20', false);
  const projected = projectPerformersChangeResponse(false, built.line, built.session);
  expect(projected).toEqual({ changed: true });
  expect(Object.keys(projected)).toEqual(['changed']);
  expect(JSON.stringify(projected)).not.toMatch(/reason|changer|20\.000/);
});

it('sums only active nets and keeps the line figures', () => {
  const changed = visitLine(20000n, 'ACTIVE');
  const other = { ...visitLine(9000n, 'ACTIVE'), id: '01990000-0000-7000-8000-00000000000e' };
  const response = savedLinePerformersChangeResponse(
    visitRecord([changed, other]),
    changed.id,
    '2026-10-20',
    false,
  );
  expect(response.line.net).toBe('20.000');
  expect(response.line.price).toBe('25.000');
  expect(response.line.discount).toBe('5.000');
  expect(response.session).toEqual({ id: changed.session_id, total_net: '29.000' });
});

it('refuses a line that is not in the visit', () => {
  const line = visitLine(20000n, 'ACTIVE');
  expect(() =>
    savedLinePerformersChangeResponse(
      visitRecord([line]),
      '01990000-0000-7000-8000-00000000000f',
      '2026-10-20',
      false,
    ),
  ).toThrow(SessionError);
});

it('refuses to build the body from a line that is not ACTIVE', () => {
  const cancelled = visitLine(20000n, 'CANCELLED');
  expect(() =>
    savedLinePerformersChangeResponse(visitRecord([cancelled]), cancelled.id, '2026-10-20', false),
  ).toThrow(/not ACTIVE/);
});

it('FR-015 marks the change with the day of the business timezone, not of UTC', () => {
  expect(performersChangedMark(new Date('2026-10-16T22:00:00.000Z'), 'Asia/Kuwait')).toBe('2026-10-17');
  expect(performersChangedMark(new Date('2026-10-16T20:59:59.000Z'), 'Asia/Kuwait')).toBe('2026-10-16');
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
