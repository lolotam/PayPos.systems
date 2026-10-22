import { describe, expect, it } from 'vitest';
import {
  BREAK_OUT_LEAD_MS,
  breakOutWindowStart,
  breakNotReturnedDecision,
  breakNotReturnedParameters,
  breakReturnedOtherBranchParameters,
  breakReturnDeadline,
  dueBreakCutoff,
  graceElapsed,
  suppressedBreakDisposition,
  type BreakNotReturnedDecision,
  type BreakNotReturnedFacts,
  type SuppressedBreakDisposition,
  type SuppressedBreakKind,
} from '../break-not-returned.ts';
import type { LeaveInterval } from '../not-clocked-in.ts';

// سارة 09:00–17:00 بتوقيت الكويت (UTC+3)، البريك 13:00–14:00.
const at = (time: string) => new Date(`2026-10-04T${time}:00.000+03:00`);
const SHIFT = { workingDate: '2026-10-04', endsAt: at('17:00'), breakEndsAt: at('14:00') };
const GRACE = 10 * 60 * 1000;

function facts(overrides: Partial<BreakNotReturnedFacts> = {}): BreakNotReturnedFacts {
  return {
    now: at('14:10'),
    shiftEndsAt: SHIFT.endsAt,
    alertAt: at('14:10'),
    excused: false,
    deleted: false,
    contractEnd: null,
    workingDate: SHIFT.workingDate,
    breakOutAt: at('13:02'),
    shiftBranchId: 'branch-a',
    returnedBranchId: null,
    ...overrides,
  };
}

function leave(overrides: Partial<LeaveInterval>): LeaveInterval {
  return {
    status: 'APPROVED',
    kind: 'PARTIAL',
    from: '2026-10-04',
    to: '2026-10-04',
    startsAt: at('14:00'),
    endsAt: at('15:00'),
    ...overrides,
  };
}

describe('breakReturnDeadline', () => {
  it('is the break end plus the grace without leave', () => {
    expect(breakReturnDeadline(SHIFT, [], GRACE)).toEqual({
      excused: false,
      alertAt: at('14:10'),
    });
  });

  it('approved full-day leave excuses; pending and rejected leave do not', () => {
    const fullDay = leave({ kind: 'FULL_DAY', startsAt: at('00:00'), endsAt: at('23:59') });
    expect(breakReturnDeadline(SHIFT, [fullDay], GRACE).excused).toBe(true);
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED'])
      expect(breakReturnDeadline(SHIFT, [{ ...fullDay, status }], GRACE)).toEqual({
        excused: false,
        alertAt: at('14:10'),
      });
  });

  it('partial leave covering the break end moves the alert to its end plus the grace', () => {
    expect(breakReturnDeadline(SHIFT, [leave({})], GRACE)).toEqual({
      excused: false,
      alertAt: at('15:10'),
    });
  });

  it('partial leave past the shift end excuses; leave starting after the break end does not move it', () => {
    expect(breakReturnDeadline(SHIFT, [leave({ endsAt: at('18:00') })], GRACE).excused).toBe(true);
    expect(breakReturnDeadline(SHIFT, [leave({ startsAt: at('14:05') })], GRACE)).toEqual({
      excused: false,
      alertAt: at('14:10'),
    });
  });
});

describe('breakNotReturnedDecision', () => {
  it('waits until the break end plus 10 minutes, then alerts', () => {
    expect(breakNotReturnedDecision(facts({ now: new Date(at('14:10').getTime() - 1) }))).toBe(
      'WAIT',
    );
    expect(breakNotReturnedDecision(facts())).toBe('ALERT');
    expect(breakNotReturnedDecision(facts({ now: at('16:59') }))).toBe('ALERT');
  });

  it('never alerts when she did not clock out inside the break', () => {
    expect(breakNotReturnedDecision(facts({ breakOutAt: null }))).toBe('NO_BREAK_OUT');
  });

  it('does not alert when she is back before the job decides', () => {
    expect(breakNotReturnedDecision(facts({ now: at('14:35'), returnedBranchId: 'branch-a' }))).toBe('RETURNED');
  });

  it('replaces the missing-return alert with a notice for a return at another branch', () => {
    expect(breakNotReturnedDecision(facts({ returnedBranchId: 'branch-b' }))).toBe('RETURNED_OTHER_BRANCH');
  });

  it('skips a finished shift and an alert moment at or after the shift end', () => {
    expect(breakNotReturnedDecision(facts({ now: at('17:00') }))).toBe('STALE');
    expect(breakNotReturnedDecision(facts({ alertAt: at('17:00') }))).toBe('STALE');
  });

  it('skips a deleted employee or a contract that ended before the working date', () => {
    expect(breakNotReturnedDecision(facts({ deleted: true }))).toBe('INELIGIBLE');
    expect(breakNotReturnedDecision(facts({ contractEnd: '2026-10-03' }))).toBe('INELIGIBLE');
    expect(breakNotReturnedDecision(facts({ contractEnd: '2026-10-04' }))).toBe('ALERT');
  });

  it('applies the binding order: stale before ineligible before no break-out before leave', () => {
    expect(
      breakNotReturnedDecision(facts({ now: at('17:00'), deleted: true, breakOutAt: null })),
    ).toBe('STALE');
    expect(breakNotReturnedDecision(facts({ deleted: true, breakOutAt: null }))).toBe(
      'INELIGIBLE',
    );
    expect(breakNotReturnedDecision(facts({ breakOutAt: null, excused: true }))).toBe(
      'NO_BREAK_OUT',
    );
    expect(breakNotReturnedDecision(facts({ excused: true, returnedBranchId: 'branch-b' }))).toBe('EXCUSED');
  });
});

it('other-branch parameters contain safe employee and destination names without a break time', () => {
  const fallback = { employeeAr: 'موظف', employeeEn: 'Employee', branchAr: 'فرع', branchEn: 'Branch' };
  expect(breakReturnedOtherBranchParameters('سارة', 'Sara', {
    branchId: 'branch-b', clockIn: at('14:05'), nameAr: 'حولي', nameEn: 'Hawalli',
  }, fallback)).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'حولي' },
    { name: 'branch_name_en', type: 'text', value: 'Hawalli' },
  ]);
  expect(breakReturnedOtherBranchParameters(null, 'https://example.test', {
    branchId: 'branch-b', clockIn: at('14:05'), nameAr: null, nameEn: 'https://example.test',
  }, fallback)).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'موظف' },
    { name: 'employee_name_en', type: 'text', value: 'Employee' },
    { name: 'branch_name_ar', type: 'text', value: 'فرع' },
    { name: 'branch_name_en', type: 'text', value: 'Branch' },
  ]);
});

describe('dueBreakCutoff', () => {
  it('is now minus the grace', () => {
    expect(dueBreakCutoff(at('14:10'), GRACE)).toEqual(at('14:00'));
  });
});

describe('graceElapsed', () => {
  it('holds until the grace after the break end has passed', () => {
    expect(graceElapsed(at('14:00'), new Date(at('14:10').getTime() - 1), GRACE)).toBe(false);
    expect(graceElapsed(at('14:00'), at('14:10'), GRACE)).toBe(true);
    expect(graceElapsed(at('14:00'), at('14:30'), GRACE)).toBe(true);
  });

  it('follows the grace it is given, so the other-branch rule delay moves it', () => {
    expect(graceElapsed(at('14:00'), at('14:05'), 5 * 60 * 1000)).toBe(true);
    expect(graceElapsed(at('14:00'), at('14:05'), 20 * 60 * 1000)).toBe(false);
  });
});

describe('suppressedBreakDisposition', () => {
  const KINDS: readonly SuppressedBreakKind[] = ['NOT_RETURNED', 'RETURNED_OTHER_BRANCH'];
  const DECISIONS: readonly BreakNotReturnedDecision[] = [
    'ALERT',
    'WAIT',
    'NO_BREAK_OUT',
    'RETURNED',
    'RETURNED_OTHER_BRANCH',
    'EXCUSED',
    'STALE',
    'INELIGIBLE',
  ];
  /** الجدول مكتوب بالحروف: أول قيمة والقاعدة مقفولة، والتانية والقاعدة شغّالة. */
  const EXPECTED: Record<
    SuppressedBreakKind,
    Record<BreakNotReturnedDecision, readonly [SuppressedBreakDisposition, SuppressedBreakDisposition]>
  > = {
    NOT_RETURNED: {
      ALERT: ['NONE', 'NONE'],
      WAIT: ['NONE', 'NONE'],
      NO_BREAK_OUT: ['NONE', 'NONE'],
      RETURNED: ['NONE', 'NONE'],
      RETURNED_OTHER_BRANCH: ['CLOSE', 'CONVERT'],
      EXCUSED: ['NONE', 'NONE'],
      STALE: ['NONE', 'NONE'],
      INELIGIBLE: ['NONE', 'NONE'],
    },
    RETURNED_OTHER_BRANCH: {
      ALERT: ['NONE', 'NONE'],
      WAIT: ['NONE', 'NONE'],
      NO_BREAK_OUT: ['NONE', 'NONE'],
      RETURNED: ['NONE', 'NONE'],
      RETURNED_OTHER_BRANCH: ['NONE', 'NONE'],
      EXCUSED: ['NONE', 'NONE'],
      STALE: ['NONE', 'NONE'],
      INELIGIBLE: ['NONE', 'NONE'],
    },
  };

  it.each(KINDS)('decides every decision for a %s suppressed row', (kind) => {
    for (const decision of DECISIONS) {
      const [closed, open] = EXPECTED[kind][decision];
      expect(
        suppressedBreakDisposition({ suppressedKind: kind, decision, otherBranchEnabled: false }),
      ).toBe(closed);
      expect(
        suppressedBreakDisposition({ suppressedKind: kind, decision, otherBranchEnabled: true }),
      ).toBe(open);
    }
  });
});

describe('breakNotReturnedParameters', () => {
  it('carries both names and the local break end, with the safe-name fallbacks', () => {
    expect(breakNotReturnedParameters('سارة', 'Sara', null, 'Salmiya', '14:00')).toEqual([
      { name: 'employee_name_ar', type: 'text', value: 'سارة' },
      { name: 'employee_name_en', type: 'text', value: 'Sara' },
      { name: 'branch_name_ar', type: 'text', value: 'Salmiya' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
      { name: 'break_end', type: 'text', value: '14:00' },
    ]);
    expect(
      breakNotReturnedParameters('https://example.test', 'www.example.test', null, 'Salmiya', '14:00')?.[1],
    ).toEqual({ name: 'employee_name_en', type: 'text', value: 'Employee' });
    expect(breakNotReturnedParameters('سارة', 'Sara', null, 'Salmiya', '24:00')).toBeNull();
  });
});

describe('breakOutWindowStart (BW-Q11)', () => {
  it('opens the break-out window 10 minutes before the break start', () => {
    expect(breakOutWindowStart(at('13:00'), BREAK_OUT_LEAD_MS)).toEqual(at('12:50'));
  });
});
