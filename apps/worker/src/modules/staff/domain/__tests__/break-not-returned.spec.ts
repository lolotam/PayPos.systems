import { describe, expect, it } from 'vitest';
import {
  BREAK_OUT_LEAD_MS,
  BREAK_RETURN_GRACE_MS,
  breakOutWindowStart,
  breakNotReturnedDecision,
  breakNotReturnedParameters,
  breakReturnDeadline,
  dueBreakCutoff,
  interimBreakNotReturnedRule,
  type BreakNotReturnedFacts,
} from '../break-not-returned.ts';
import { interimNotClockedInRule, type LeaveInterval } from '../not-clocked-in.ts';

// سارة 09:00–17:00 بتوقيت الكويت (UTC+3)، البريك 13:00–14:00.
const at = (time: string) => new Date(`2026-10-04T${time}:00.000+03:00`);
const SHIFT = { workingDate: '2026-10-04', endsAt: at('17:00'), breakEndsAt: at('14:00') };

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
    returned: false,
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

describe('interim rule', () => {
  it('reuses the not-clocked-in roles and channel with a 10-minute grace', () => {
    const rule = interimBreakNotReturnedRule();
    expect(rule).toEqual({
      enabled: true,
      graceMs: 10 * 60 * 1000,
      breakOutLeadMs: 10 * 60 * 1000,
      channel: 'IN_APP',
      roles: interimNotClockedInRule().roles,
    });
    expect(BREAK_RETURN_GRACE_MS).toBe(600_000);
  });
});

describe('breakReturnDeadline', () => {
  it('is the break end plus the grace without leave', () => {
    expect(breakReturnDeadline(SHIFT, [], BREAK_RETURN_GRACE_MS)).toEqual({
      excused: false,
      alertAt: at('14:10'),
    });
  });

  it('approved full-day leave excuses; pending and rejected leave do not', () => {
    const fullDay = leave({ kind: 'FULL_DAY', startsAt: at('00:00'), endsAt: at('23:59') });
    expect(breakReturnDeadline(SHIFT, [fullDay], BREAK_RETURN_GRACE_MS).excused).toBe(true);
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED'])
      expect(
        breakReturnDeadline(SHIFT, [{ ...fullDay, status }], BREAK_RETURN_GRACE_MS),
      ).toEqual({ excused: false, alertAt: at('14:10') });
  });

  it('partial leave covering the break end moves the alert to its end plus the grace', () => {
    expect(breakReturnDeadline(SHIFT, [leave({})], BREAK_RETURN_GRACE_MS)).toEqual({
      excused: false,
      alertAt: at('15:10'),
    });
  });

  it('partial leave past the shift end excuses; leave starting after the break end does not move it', () => {
    expect(
      breakReturnDeadline(SHIFT, [leave({ endsAt: at('18:00') })], BREAK_RETURN_GRACE_MS).excused,
    ).toBe(true);
    expect(
      breakReturnDeadline(SHIFT, [leave({ startsAt: at('14:05') })], BREAK_RETURN_GRACE_MS),
    ).toEqual({ excused: false, alertAt: at('14:10') });
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
    expect(breakNotReturnedDecision(facts({ now: at('14:35'), returned: true }))).toBe('RETURNED');
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
    expect(breakNotReturnedDecision(facts({ excused: true, returned: true }))).toBe('EXCUSED');
  });
});

describe('dueBreakCutoff', () => {
  it('is now minus the grace', () => {
    expect(dueBreakCutoff(at('14:10'), BREAK_RETURN_GRACE_MS)).toEqual(at('14:00'));
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
