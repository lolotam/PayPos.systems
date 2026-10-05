import { describe, expect, it } from 'vitest';
import { materializeLeave, validateLeaveOverlap } from '../leave-period.ts';
import { cancelPendingLeave, leaveSnapshot, validateLeaveEmployee } from '../leave-policy.ts';
import type { LeaveEmployee, LeaveRecord, LeaveTerms } from '../leave-types.ts';
const now = new Date('2026-10-03T22:00:00Z');
const full: LeaveTerms = { kind: 'FULL_DAY', from: '2026-10-04', to: '2026-10-05', type: 'ANNUAL' };
const employee: LeaveEmployee = {
  id: 'employee',
  user_id: 'user',
  hire_date: '2026-01-01',
  contract_end: null,
  deleted_at: null,
  attachments: [{ branch_id: 'branch', from: '2026-01-01', to: null }],
};
const record: LeaveRecord = {
  ...materializeLeave(full, 'Asia/Kuwait', now, true),
  id: 'leave',
  business_id: 'business',
  branch_id: 'branch',
  employee_id: 'employee',
  status: 'PENDING',
  requested_by: 'user',
  requested_at: now.toISOString(),
  cancelled_by: null,
  cancelled_at: null,
  decided_by: null,
  decided_at: null,
  rejection_reason: null,
  decision_reason: null,
  revoked_by: null,
  revoked_at: null,
  revocation_reason: null,
  revision: 1,
};
describe('leave periods', () => {
  it('includes both local days and captures independent UTC endpoints', () => {
    expect(record.starts_at).toBe('2026-10-03T21:00:00.000Z');
    expect(record.ends_at).toBe('2026-10-05T21:00:00.000Z');
  });
  it.each(['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const)(
    'accepts %s with trimmed optional note',
    (type) => {
      expect(
        materializeLeave({ ...full, type, note: '  Synthetic note  ' }, 'Asia/Kuwait', now, false)
          .note,
      ).toBe('Synthetic note');
    },
  );
  it.each([undefined, '', ' ', 'a'.repeat(501)])('rejects invalid OTHER note %s', (note) => {
    expect(() =>
      materializeLeave(
        { ...full, type: 'OTHER', ...(note === undefined ? {} : { note }) },
        'Asia/Kuwait',
        now,
        false,
      ),
    ).toThrow('LEAVE_NOTE_REQUIRED');
  });
  it('accepts 500 characters and optional absence for non-OTHER', () => {
    expect(
      materializeLeave({ ...full, note: 'a'.repeat(500) }, 'Asia/Kuwait', now, false).note,
    ).toHaveLength(500);
    expect(record.note).toBeNull();
  });
  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-10-05', '2026-10-04'],
    ['bad', 'bad'],
  ])('refuses invalid date %s through %s', (from, to) => {
    expect(() => materializeLeave({ ...full, from, to }, 'Asia/Kuwait', now, false)).toThrow(
      'LEAVE_PERIOD_INVALID',
    );
  });
});
describe('local dates and partial times', () => {
  it('uses branch today for own requests while managers may backdate', () => {
    const past = { ...full, from: '2026-10-03' };
    expect(() => materializeLeave(past, 'Asia/Kuwait', now, true)).toThrow(
      'LEAVE_PAST_OWN_FORBIDDEN',
    );
    expect(materializeLeave(past, 'Asia/Kuwait', now, false).from).toBe('2026-10-03');
  });
  it('accepts a single full day and local quarter-hour partial times', () => {
    const p = materializeLeave(
      { kind: 'PARTIAL', type: 'SICK', date: '2026-10-04', start: '09:00', end: '10:15' },
      'Asia/Kuwait',
      now,
      true,
    );
    expect([p.starts_at, p.ends_at]).toEqual([
      '2026-10-04T06:00:00.000Z',
      '2026-10-04T07:15:00.000Z',
    ]);
    expect(materializeLeave({ ...full, to: full.from }, 'Asia/Kuwait', now, true).ends_at).toBe(
      '2026-10-04T21:00:00.000Z',
    );
  });
  it.each([
    ['10:00', '10:00'],
    ['23:00', '01:00'],
    ['24:00', '25:00'],
    ['9:00', '10:00'],
  ])('rejects invalid partial %s–%s', (start, end) => {
    expect(() =>
      materializeLeave(
        { kind: 'PARTIAL', type: 'SICK', date: '2026-10-04', start, end },
        'Asia/Kuwait',
        now,
        false,
      ),
    ).toThrow('LEAVE_PERIOD_INVALID');
  });
});
describe('DST and span', () => {
  it.each([
    ['2026-03-08', '02:15'],
    ['2026-11-01', '01:15'],
  ])('refuses DST gap/fold %s', (date, start) => {
    expect(() =>
      materializeLeave(
        { kind: 'PARTIAL', type: 'OTHER', note: 'Synthetic', date, start, end: '03:30' },
        'America/New_York',
        now,
        false,
      ),
    ).toThrow('LEAVE_LOCAL_TIME_INVALID');
  });
  it('full DST days are civil days, including 23/25 hour days', () => {
    const durations = ['2026-03-08', '2026-11-01'].map((from) => {
      const p = materializeLeave({ ...full, from, to: from }, 'America/New_York', now, false);
      return (Date.parse(p.ends_at) - Date.parse(p.starts_at)) / 3_600_000;
    });
    expect(durations).toEqual([23, 25]);
  });
  it('refuses a full-day request exceeding the settled maximum', () =>
    expect(() =>
      materializeLeave({ ...full, to: '2027-10-04' }, 'Asia/Kuwait', now, false),
    ).toThrow('LEAVE_SPAN_TOO_LONG'));
});
describe('overlap, eligibility and lifecycle', () => {
  it.each(['PENDING', 'APPROVED'] as const)('blocks %s intersections and containment', (status) => {
    expect(() => validateLeaveOverlap(record, [{ ...record, status }])).toThrow('LEAVE_OVERLAP');
    expect(() =>
      validateLeaveOverlap(
        { starts_at: '2026-10-04T01:00:00.000Z', ends_at: '2026-10-04T02:00:00.000Z' },
        [{ ...record, status }],
      ),
    ).toThrow('LEAVE_OVERLAP');
  });
  it.each(['CANCELLED', 'REJECTED'] as const)(
    'ignores %s and accepts adjacent periods',
    (status) => {
      expect(() => validateLeaveOverlap(record, [{ ...record, status }])).not.toThrow();
      expect(() =>
        validateLeaveOverlap({ starts_at: record.ends_at, ends_at: '2026-10-06T21:00:00.000Z' }, [
          record,
        ]),
      ).not.toThrow();
    },
  );
  it('accepts service boundaries and continuous dated attachments', () => {
    expect(() => validateLeaveEmployee(employee, 'branch', record)).not.toThrow();
    expect(() =>
      validateLeaveEmployee(
        {
          ...employee,
          contract_end: record.to,
          attachments: [
            { branch_id: 'branch', from: '2026-01-01', to: '2026-10-05' },
            { branch_id: 'branch', from: '2026-10-05', to: '2026-10-06' },
          ],
        },
        'branch',
        record,
      ),
    ).not.toThrow();
  });
  it.each([
    { ...employee, deleted_at: '2026-01-01' },
    { ...employee, hire_date: '2026-10-05' },
    { ...employee, contract_end: '2026-10-04' },
    { ...employee, attachments: [] },
    { ...employee, attachments: [{ branch_id: 'branch', from: '2026-01-01', to: record.to }] },
    {
      ...employee,
      attachments: [
        { branch_id: 'branch', from: '2026-01-01', to: '2026-10-04' },
        { branch_id: 'branch', from: '2026-10-05', to: null },
      ],
    },
  ])('rejects ineligible period %#', (e) =>
    expect(() => validateLeaveEmployee(e, 'branch', record)).toThrow('LEAVE_EMPLOYEE_INELIGIBLE'),
  );
});
describe('leave cancellation and snapshots', () => {
  it('cancels own or managerial pending leave without mutating input', () => {
    const after = cancelPendingLeave(record, 'user', true, 1, now);
    expect([after.status, after.revision, after.cancelled_by, record.status]).toEqual([
      'CANCELLED',
      2,
      'user',
      'PENDING',
    ]);
    expect(cancelPendingLeave(record, 'manager', false, 1, now).cancelled_by).toBe('manager');
  });
  it.each(['APPROVED', 'REJECTED', 'CANCELLED'] as const)('cannot cancel %s', (status) =>
    expect(() => cancelPendingLeave({ ...record, status }, 'user', true, 1, now)).toThrow(
      'LEAVE_NOT_PENDING',
    ),
  );
  it('refuses wrong requester, stale revision and revision overflow', () => {
    expect(() => cancelPendingLeave(record, 'other', true, 1, now)).toThrow('NOT_FOUND');
    expect(() => cancelPendingLeave(record, 'user', true, 2, now)).toThrow(
      'LEAVE_REVISION_CONFLICT',
    );
    expect(() =>
      cancelPendingLeave({ ...record, revision: 2147483647 }, 'user', true, 2147483647, now),
    ).toThrow('LEAVE_REVISION_CONFLICT');
  });
  it('excludes health notes and rejection text from events/audit', () =>
    expect(leaveSnapshot({ ...record, note: 'Synthetic health note' })).not.toHaveProperty('note'));
});
