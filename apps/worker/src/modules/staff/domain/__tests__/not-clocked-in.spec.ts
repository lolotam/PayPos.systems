import { describe, expect, it } from 'vitest';
import {
  alertMoment,
  applyApprovedLeave,
  countingWindow,
  dueShiftCutoff,
  formatLocalShiftStart,
  interimNotClockedInRule,
  notClockedInDecision,
  noticeDisplayName,
  recordNotClockedInOutcome,
  shiftNotClockedInParameters,
  withoutAbsentEmployee,
  type LeaveInterval,
  type NotClockedInFacts,
} from '../not-clocked-in.ts';

const MINUTE = 60 * 1000;
const START = new Date('2026-10-04T07:00:00.000Z');
const END = new Date('2026-10-04T15:00:00.000Z');
const DELAY = 20 * MINUTE;
const WINDOW = 2 * 60 * MINUTE;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const leave = (status: string, startsAt: Date, endsAt: Date): LeaveInterval => ({
  status,
  startsAt,
  endsAt,
});

function facts(patch: Partial<NotClockedInFacts> = {}): NotClockedInFacts {
  const alertAt = alertMoment(START, DELAY);
  return {
    now: alertAt,
    shiftEndsAt: END,
    alertAt,
    windowStart: countingWindow(START, alertAt, WINDOW).start,
    excused: false,
    deleted: false,
    contractEnd: null,
    workingDate: '2026-10-04',
    clockIns: [],
    ...patch,
  };
}

describe('interim rule and elapsed alert moment', () => {
  it('keeps the fixed interim rule in one place', () => {
    expect(interimNotClockedInRule()).toEqual({
      enabled: true,
      delayMs: DELAY,
      windowBeforeMs: WINDOW,
      channel: 'IN_APP',
      roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
    });
  });

  it('adds twenty elapsed minutes and opens the window two hours before the start', () => {
    const alertAt = alertMoment(START, DELAY);
    expect(alertAt).toEqual(at(START, DELAY));
    expect(countingWindow(START, alertAt, WINDOW)).toEqual({
      start: at(START, -WINDOW),
      end: alertAt,
    });
    expect(dueShiftCutoff(alertAt, DELAY)).toEqual(START);
  });

  it('keeps elapsed time across a DST fall-back and a spring-forward', () => {
    const fall = new Date('2026-11-01T05:50:00.000Z');
    const spring = new Date('2026-03-08T06:50:00.000Z');
    expect(alertMoment(fall, DELAY)).toEqual(new Date('2026-11-01T06:10:00.000Z'));
    expect(alertMoment(spring, DELAY)).toEqual(new Date('2026-03-08T07:10:00.000Z'));
    expect(formatLocalShiftStart(fall, 'America/New_York')).toBe('01:50');
    expect(formatLocalShiftStart(alertMoment(fall, DELAY), 'America/New_York')).toBe('01:10');
    expect(formatLocalShiftStart(spring, 'America/New_York')).toBe('01:50');
    expect(formatLocalShiftStart(alertMoment(spring, DELAY), 'America/New_York')).toBe('03:10');
    expect(formatLocalShiftStart(START, 'Asia/Kuwait')).toBe('10:00');
  });
});

describe('notClockedInDecision', () => {
  it('waits until the alert instant and alerts on it', () => {
    expect(notClockedInDecision(facts({ now: at(START, DELAY - 1) }))).toBe('WAIT');
    expect(notClockedInDecision(facts())).toBe('ALERT');
  });

  it('counts a clock-in at either inclusive window edge and ignores one second earlier', () => {
    const alertAt = alertMoment(START, DELAY);
    const windowStart = at(START, -WINDOW);
    expect(notClockedInDecision(facts({ clockIns: [alertAt] }))).toBe('CLOCKED_IN');
    expect(notClockedInDecision(facts({ clockIns: [windowStart] }))).toBe('CLOCKED_IN');
    expect(notClockedInDecision(facts({ clockIns: [at(windowStart, -1)] }))).toBe('ALERT');
  });

  it('still counts a clock-in that was followed by a clock-out', () => {
    expect(notClockedInDecision(facts({ clockIns: [START] }))).toBe('CLOCKED_IN');
  });

  it('is stale once the shift has ended, including an overnight shift', () => {
    const overnightEnd = new Date('2026-10-05T02:00:00.000Z');
    expect(notClockedInDecision(facts({ now: END }))).toBe('STALE');
    expect(notClockedInDecision(facts({ now: at(overnightEnd, -1), shiftEndsAt: overnightEnd }))).toBe(
      'ALERT',
    );
    expect(notClockedInDecision(facts({ now: overnightEnd, shiftEndsAt: overnightEnd }))).toBe('STALE');
  });

  it('skips a deleted employee and a contract that ended before the working date', () => {
    expect(notClockedInDecision(facts({ deleted: true }))).toBe('INELIGIBLE');
    expect(notClockedInDecision(facts({ contractEnd: '2026-10-03' }))).toBe('INELIGIBLE');
    expect(notClockedInDecision(facts({ contractEnd: '2026-10-04' }))).toBe('ALERT');
  });
});

describe('applyApprovedLeave', () => {
  const shift = { startsAt: START, endsAt: END };

  it('ignores pending, rejected and cancelled leave', () => {
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED']) {
      const applied = applyApprovedLeave(shift, [leave(status, START, END)], DELAY);
      expect(applied).toEqual({ excused: false, alertAt: alertMoment(START, DELAY) });
      expect(notClockedInDecision(facts({ ...applied }))).toBe('ALERT');
    }
  });

  it('excuses approved leave that passes the shift end and defers a partial leave', () => {
    const full = applyApprovedLeave(shift, [leave('APPROVED', at(START, -WINDOW), at(END, MINUTE))], DELAY);
    expect(full.excused).toBe(true);
    expect(notClockedInDecision(facts({ excused: true, alertAt: full.alertAt }))).toBe('EXCUSED');
    const partialEnd = new Date('2026-10-04T09:00:00.000Z');
    const partial = applyApprovedLeave(shift, [leave('APPROVED', START, partialEnd)], DELAY);
    expect(partial).toEqual({ excused: false, alertAt: at(partialEnd, DELAY) });
    expect(notClockedInDecision(facts({ now: at(START, DELAY), alertAt: partial.alertAt }))).toBe('WAIT');
    expect(notClockedInDecision(facts({ now: partial.alertAt, alertAt: partial.alertAt }))).toBe('ALERT');
  });

  it('treats approved leave that ends exactly at the shift end as stale', () => {
    const applied = applyApprovedLeave(shift, [leave('APPROVED', START, END)], DELAY);
    expect(applied.excused).toBe(false);
    expect(notClockedInDecision(facts({ now: at(START, DELAY), alertAt: applied.alertAt }))).toBe('STALE');
  });

  it('walks contiguous approved leaves and stops at a gap', () => {
    const firstEnd = new Date('2026-10-04T08:00:00.000Z');
    const secondEnd = new Date('2026-10-04T09:00:00.000Z');
    const contiguous = applyApprovedLeave(
      shift,
      [leave('APPROVED', firstEnd, secondEnd), leave('APPROVED', START, firstEnd)],
      DELAY,
    );
    expect(contiguous.alertAt).toEqual(at(secondEnd, DELAY));
    const gapped = applyApprovedLeave(
      shift,
      [leave('APPROVED', START, firstEnd), leave('APPROVED', at(firstEnd, MINUTE), secondEnd)],
      DELAY,
    );
    expect(gapped.alertAt).toEqual(at(firstEnd, DELAY));
  });
});

describe('recipient text', () => {
  it('prefers a non-blank Arabic name and drops the absent employee', () => {
    expect(noticeDisplayName('  ليلى  ', 'Layla')).toBe('ليلى');
    expect(noticeDisplayName('   ', 'Layla')).toBe('Layla');
    expect(noticeDisplayName(null, 'Layla')).toBe('Layla');
    expect(withoutAbsentEmployee(['a', 'b', 'a', 'c'], 'b')).toEqual(['a', 'c']);
    expect(withoutAbsentEmployee(['a'], null)).toEqual(['a']);
  });

  it('accepts a safe HH:MM parameter tuple and refuses unsafe text', () => {
    expect(shiftNotClockedInParameters('ليلى', 'فرع السالمية', '10:00')).toEqual([
      { name: 'employee_name', type: 'text', value: 'ليلى' },
      { name: 'branch_name', type: 'text', value: 'فرع السالمية' },
      { name: 'shift_start', type: 'text', value: '10:00' },
    ]);
    expect(shiftNotClockedInParameters('123456', 'فرع', '10:00')).toBeNull();
    expect(recordNotClockedInOutcome({ notified: 1, failed: 0 }, null)).toEqual({
      notified: 1,
      failed: 1,
    });
    expect(recordNotClockedInOutcome({ notified: 0, failed: 0 }, true).notified).toBe(1);
  });
});
