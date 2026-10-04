import { describe, expect, it } from 'vitest';
import {
  missedOutAction,
  missedOutCandidateCutoff,
  missedOutDeadline,
  suspectedMissedOutDueAt,
  type MissedOutSession,
} from '../missed-out.ts';

const H = 60 * 60 * 1000;
const clockIn = new Date('2026-10-05T05:00:00Z');
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const session = (patch: Partial<MissedOutSession> = {}): MissedOutSession => ({
  id: '01920000-0000-7000-8000-000000000001',
  employeeId: '01920000-0000-7000-8000-000000000002',
  clockIn,
  scheduledEnd: null,
  suspectedRaised: false,
  ...patch,
});

describe('suspectedMissedOutDueAt', () => {
  it('uses the scheduled end plus four hours when the snapshot shift ends after the clock-in', () => {
    const end = at(clockIn, 9 * H);
    expect(suspectedMissedOutDueAt(session({ scheduledEnd: end }))).toEqual(at(end, 4 * H));
  });

  it('falls back to clock-in plus twelve hours without a schedule', () => {
    expect(suspectedMissedOutDueAt(session())).toEqual(at(clockIn, 12 * H));
  });

  it('treats a snapshot shift that ended at or before the clock-in as no schedule', () => {
    expect(suspectedMissedOutDueAt(session({ scheduledEnd: clockIn }))).toEqual(
      at(clockIn, 12 * H),
    );
    expect(suspectedMissedOutDueAt(session({ scheduledEnd: at(clockIn, -3 * H) }))).toEqual(
      at(clockIn, 12 * H),
    );
    expect(suspectedMissedOutDueAt(session({ scheduledEnd: at(clockIn, 1) }))).toEqual(
      at(clockIn, 1 + 4 * H),
    );
  });

  it('an overnight shift ending the next calendar day is due four hours after that end', () => {
    const start = new Date('2026-10-05T18:00:00Z');
    const end = new Date('2026-10-06T02:00:00Z');
    expect(
      suspectedMissedOutDueAt(session({ clockIn: start, scheduledEnd: end })).toISOString(),
    ).toBe('2026-10-06T06:00:00.000Z');
  });

  it('counts elapsed hours across a DST change, never wall-clock hours', () => {
    // نهاية وردية 00:30 بتوقيت نيويورك ليلة تقديم الساعة: الاستحقاق 05:30 على الحائط = ٤ ساعات منقضية.
    const spring = new Date('2026-03-08T05:30:00Z');
    const due = suspectedMissedOutDueAt(
      session({ clockIn: at(spring, -8 * H), scheduledEnd: spring }),
    );
    expect(due.getTime() - spring.getTime()).toBe(4 * H);
    expect(wall(due, 'America/New_York')).toBe('05:30');
    // ليلة تأخير الساعة: نفس المدة المنقضية تظهر 03:30 على الحائط.
    const fall = new Date('2026-11-01T04:30:00Z');
    const back = suspectedMissedOutDueAt(
      session({ clockIn: at(fall, -8 * H), scheduledEnd: fall }),
    );
    expect(back.getTime() - fall.getTime()).toBe(4 * H);
    expect(wall(back, 'America/New_York')).toBe('03:30');
    const noSchedule = suspectedMissedOutDueAt(session({ clockIn: at(spring, -6 * H) }));
    expect(noSchedule.getTime() - at(spring, -6 * H).getTime()).toBe(12 * H);
  });
});

describe('missedOutDeadline', () => {
  it('is exactly sixteen elapsed hours after the clock-in, also across DST', () => {
    expect(missedOutDeadline(clockIn)).toEqual(at(clockIn, 16 * H));
    const spring = new Date('2026-03-08T01:00:00Z');
    expect(missedOutDeadline(spring).getTime() - spring.getTime()).toBe(16 * H);
  });
});

describe('missedOutAction', () => {
  const scheduled = session({ scheduledEnd: at(clockIn, 8 * H) });

  it('does nothing one millisecond before the scheduled end plus four hours, raises exactly at it', () => {
    expect(missedOutAction(scheduled, at(clockIn, 12 * H - 1))).toBe('NONE');
    expect(missedOutAction(scheduled, at(clockIn, 12 * H))).toBe('RAISE_SUSPECTED');
  });

  it('without a schedule raises exactly at clock-in plus twelve hours', () => {
    expect(missedOutAction(session(), at(clockIn, 12 * H - 1))).toBe('NONE');
    expect(missedOutAction(session(), at(clockIn, 12 * H))).toBe('RAISE_SUSPECTED');
  });

  it('never raises a second suspected exception', () => {
    const raised = { ...scheduled, suspectedRaised: true };
    expect(missedOutAction(raised, at(clockIn, 12 * H))).toBe('NONE');
    expect(missedOutAction(raised, at(clockIn, 16 * H - 1))).toBe('NONE');
  });

  it('closes MISSED_OUT exactly at sixteen hours, raised or not, and later', () => {
    for (const s of [scheduled, session(), { ...scheduled, suspectedRaised: true }]) {
      expect(missedOutAction(s, at(clockIn, 16 * H - 1))).not.toBe('CLOSE_MISSED_OUT');
      expect(missedOutAction(s, at(clockIn, 16 * H))).toBe('CLOSE_MISSED_OUT');
      expect(missedOutAction(s, at(clockIn, 40 * H))).toBe('CLOSE_MISSED_OUT');
    }
  });

  it('skips the suspected step when the due time is at or after the sixteen-hour deadline', () => {
    const long = session({ scheduledEnd: at(clockIn, 12 * H) });
    expect(suspectedMissedOutDueAt(long)).toEqual(missedOutDeadline(clockIn));
    expect(missedOutAction(long, at(clockIn, 16 * H - 1))).toBe('NONE');
    expect(missedOutAction(long, at(clockIn, 16 * H))).toBe('CLOSE_MISSED_OUT');
    const later = session({ scheduledEnd: at(clockIn, 14 * H) });
    expect(missedOutAction(later, at(clockIn, 16 * H - 1))).toBe('NONE');
  });

  it('a shift ending one millisecond after the clock-in can raise as early as four hours', () => {
    const brief = session({ scheduledEnd: at(clockIn, 1) });
    expect(missedOutAction(brief, at(clockIn, 4 * H))).toBe('NONE');
    expect(missedOutAction(brief, at(clockIn, 4 * H + 1))).toBe('RAISE_SUSPECTED');
  });
});

describe('missedOutCandidateCutoff', () => {
  it('is four hours before now, so no session that can act is ever filtered out', () => {
    const now = new Date('2026-10-05T20:00:00Z');
    const cutoff = missedOutCandidateCutoff(now);
    expect(cutoff).toEqual(at(now, -4 * H));
    const earliest = session({ clockIn: cutoff, scheduledEnd: at(cutoff, 1) });
    expect(missedOutAction(earliest, now)).toBe('NONE');
    const younger = session({ clockIn: at(cutoff, 1), scheduledEnd: at(cutoff, 2) });
    expect(missedOutAction(younger, now)).toBe('NONE');
  });
});

function wall(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}
