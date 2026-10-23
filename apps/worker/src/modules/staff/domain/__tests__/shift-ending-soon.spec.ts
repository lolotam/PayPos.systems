import { describe, expect, it } from 'vitest';
import {
  remindMoment,
  shiftEndingSoonDecision,
  shiftEndsSoonParameters,
  type ShiftEndingSoonFacts,
} from '../shift-ending-soon.ts';

// مونا 10:00–18:00 بتوقيت الكويت (UTC+3)، والوردية متخزّنة 07:00Z–15:00Z.
const MINUTE = 60 * 1000;
const LEAD = 30 * MINUTE;
const START = new Date('2026-10-04T07:00:00.000Z');
const END = new Date('2026-10-04T15:00:00.000Z');
const REMIND_AT = new Date('2026-10-04T14:30:00.000Z');
const WORKING_DATE = '2026-10-04';
const utc = (iso: string) => new Date(iso);

function facts(patch: Partial<ShiftEndingSoonFacts> = {}): ShiftEndingSoonFacts {
  return {
    now: REMIND_AT,
    shiftEndsAt: END,
    remindAt: REMIND_AT,
    workingDate: WORKING_DATE,
    deleted: false,
    contractEnd: null,
    excused: false,
    ruleEnabled: true,
    hasOpenSession: true,
    ...patch,
  };
}

describe('remindMoment', () => {
  it('is the shift end minus half an hour', () => {
    expect(remindMoment(START, END, LEAD)).toEqual(utc('2026-10-04T14:30:00.000Z'));
  });

  it('is the shift end minus a longer lead', () => {
    expect(remindMoment(START, END, 45 * MINUTE)).toEqual(utc('2026-10-04T14:15:00.000Z'));
  });

  it('never precedes the shift start when the lead is longer than the shift', () => {
    const oneHour = utc('2026-10-04T08:00:00.000Z');
    expect(remindMoment(START, oneHour, 90 * MINUTE)).toEqual(START);
  });

  it('is the shift end itself when the lead is zero', () => {
    expect(remindMoment(START, END, 0)).toEqual(END);
  });

  it('gives each shift of a split day its own moment', () => {
    const morning = remindMoment(
      utc('2026-10-04T06:00:00.000Z'),
      utc('2026-10-04T10:00:00.000Z'),
      LEAD,
    );
    const evening = remindMoment(
      utc('2026-10-04T14:00:00.000Z'),
      utc('2026-10-04T18:00:00.000Z'),
      LEAD,
    );
    expect(morning).toEqual(utc('2026-10-04T09:30:00.000Z'));
    expect(evening).toEqual(utc('2026-10-04T17:30:00.000Z'));
  });

  it('is due at 05:30 local the next day for an overnight shift', () => {
    expect(
      remindMoment(utc('2026-10-04T19:00:00.000Z'), utc('2026-10-05T03:00:00.000Z'), LEAD),
    ).toEqual(utc('2026-10-05T02:30:00.000Z'));
  });

  it('keeps elapsed time across a DST fall-back and a spring-forward', () => {
    expect(
      remindMoment(utc('2026-11-01T02:00:00.000Z'), utc('2026-11-01T11:00:00.000Z'), LEAD),
    ).toEqual(utc('2026-11-01T10:30:00.000Z'));
    expect(
      remindMoment(utc('2026-03-08T03:00:00.000Z'), utc('2026-03-08T11:00:00.000Z'), LEAD),
    ).toEqual(utc('2026-03-08T10:30:00.000Z'));
  });

  it('returns a new date and leaves the given moments untouched', () => {
    const startsAt = utc('2026-10-04T07:00:00.000Z');
    const endsAt = utc('2026-10-04T15:00:00.000Z');
    const moment = remindMoment(startsAt, endsAt, LEAD);
    expect(moment).not.toBe(startsAt);
    expect(moment).not.toBe(endsAt);
    expect(startsAt.toISOString()).toBe('2026-10-04T07:00:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-10-04T15:00:00.000Z');
  });
});

describe('shiftEndingSoonDecision', () => {
  it('waits a millisecond before the moment', () => {
    const justBefore = new Date(REMIND_AT.getTime() - 1);
    expect(shiftEndingSoonDecision(facts({ now: justBefore }))).toBe('WAIT');
  });

  it('reminds on the moment', () => {
    expect(shiftEndingSoonDecision(facts())).toBe('REMIND');
  });

  it('reminds until the last millisecond of the shift', () => {
    expect(shiftEndingSoonDecision(facts({ now: utc('2026-10-04T14:59:59.999Z') }))).toBe('REMIND');
  });

  it('is stale at the shift end even for an absent employee with the rule off', () => {
    const decision = shiftEndingSoonDecision(
      facts({ now: END, hasOpenSession: false, ruleEnabled: false, deleted: true }),
    );
    expect(decision).toBe('STALE');
  });

  it('is stale before ineligible', () => {
    expect(shiftEndingSoonDecision(facts({ now: END, deleted: true }))).toBe('STALE');
  });

  it('skips a deleted employee', () => {
    expect(shiftEndingSoonDecision(facts({ deleted: true }))).toBe('INELIGIBLE');
  });

  it('skips a contract that ended before the working date and keeps one ending on it', () => {
    expect(shiftEndingSoonDecision(facts({ contractEnd: '2026-10-03' }))).toBe('INELIGIBLE');
    expect(shiftEndingSoonDecision(facts({ contractEnd: '2026-10-04' }))).toBe('REMIND');
  });

  it('is ineligible before excused', () => {
    expect(shiftEndingSoonDecision(facts({ deleted: true, excused: true }))).toBe('INELIGIBLE');
  });

  it('is excused by approved leave even with the rule off', () => {
    expect(shiftEndingSoonDecision(facts({ excused: true, ruleEnabled: false }))).toBe('EXCUSED');
  });

  it('is excused before waiting', () => {
    const justBefore = new Date(REMIND_AT.getTime() - 1);
    expect(shiftEndingSoonDecision(facts({ excused: true, now: justBefore }))).toBe('EXCUSED');
  });

  it('waits before the suppression of an off rule', () => {
    const justBefore = new Date(REMIND_AT.getTime() - 1);
    expect(shiftEndingSoonDecision(facts({ ruleEnabled: false, now: justBefore }))).toBe('WAIT');
  });

  it('suppresses an off rule after the moment, whether she is present or not', () => {
    expect(shiftEndingSoonDecision(facts({ ruleEnabled: false }))).toBe('SUPPRESS');
    const absent = shiftEndingSoonDecision(facts({ ruleEnabled: false, hasOpenSession: false }));
    expect(absent).toBe('SUPPRESS');
  });

  it('skips an absent employee with the rule on', () => {
    expect(shiftEndingSoonDecision(facts({ hasOpenSession: false }))).toBe('NOT_PRESENT');
  });

  it('reminds a present employee with the rule on', () => {
    expect(shiftEndingSoonDecision(facts())).toBe('REMIND');
  });

  it('reminds a late clock-in while the shift still runs', () => {
    expect(shiftEndingSoonDecision(facts({ now: utc('2026-10-04T14:50:00.000Z') }))).toBe('REMIND');
    expect(shiftEndingSoonDecision(facts({ now: utc('2026-10-04T14:59:59.999Z') }))).toBe('REMIND');
  });
});

describe('shiftEndsSoonParameters', () => {
  it('carries the shift end first and the branch names in both languages', () => {
    expect(shiftEndsSoonParameters('السالمية', 'Salmiya', '18:00')).toEqual([
      { name: 'shift_end', type: 'text', value: '18:00' },
      { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    ]);
  });

  it('falls back to the English name when the Arabic one is missing or refused', () => {
    expect(shiftEndsSoonParameters(null, 'Salmiya', '18:00')?.[1]).toEqual({
      name: 'branch_name_ar',
      type: 'text',
      value: 'Salmiya',
    });
    expect(shiftEndsSoonParameters('https://example.test', 'Salmiya', '18:00')?.[1]).toEqual({
      name: 'branch_name_ar',
      type: 'text',
      value: 'Salmiya',
    });
  });

  it('falls back to the generic label when the English name is refused', () => {
    expect(shiftEndsSoonParameters(null, 'https://example.test', '18:00')?.[2]).toEqual({
      name: 'branch_name_en',
      type: 'text',
      value: 'Branch',
    });
    expect(shiftEndsSoonParameters(null, '+96500000001', '18:00')?.[2]).toEqual({
      name: 'branch_name_en',
      type: 'text',
      value: 'Branch',
    });
  });

  it('uses the catalog fallback it is given', () => {
    const parameters = shiftEndsSoonParameters(null, 'https://example.test', '18:00', {
      employeeAr: 'موظف',
      employeeEn: 'Employee',
      branchAr: 'فرع',
      branchEn: 'Branch',
    });
    expect(parameters?.map((parameter) => parameter.value)).toEqual(['18:00', 'فرع', 'Branch']);
  });

  it('refuses a shift end that is not a 24-hour time', () => {
    for (const shiftEnd of ['24:00', '9:00', '18:60', ''])
      expect(shiftEndsSoonParameters(null, 'Salmiya', shiftEnd)).toBeNull();
  });

  it('accepts the edges of the 24-hour day', () => {
    expect(shiftEndsSoonParameters(null, 'Salmiya', '00:00')?.[0]).toEqual({
      name: 'shift_end',
      type: 'text',
      value: '00:00',
    });
    expect(shiftEndsSoonParameters(null, 'Salmiya', '23:59')?.[0]).toEqual({
      name: 'shift_end',
      type: 'text',
      value: '23:59',
    });
  });
});
