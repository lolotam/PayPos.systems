import { expect, it } from 'vitest';
import {
  applyApprovedLeave, notClockedInDecision, type NotClockedInFacts,
} from '../not-clocked-in.ts';

const facts: NotClockedInFacts = {
  now: new Date('2026-10-04T09:50:00Z'),
  shiftEndsAt: new Date('2026-10-04T15:00:00Z'),
  alertAt: new Date('2026-10-04T09:50:00Z'),
  windowStart: new Date('2026-10-04T07:30:00Z'),
  workingDate: '2026-10-04',
  excused: false, deleted: false, contractEnd: null, clockIns: [], openClockIn: null,
};

it('NC-Q13 counts the OPEN 07:55 session at the 12:50 split-shift deadline', () => {
  const early = new Date('2026-10-04T04:55:00Z');
  expect(notClockedInDecision({ ...facts, openClockIn: early })).toBe('CLOCKED_IN');
  expect(notClockedInDecision({ ...facts, clockIns: [early] })).toBe('ALERT');
  expect(notClockedInDecision({ ...facts, openClockIn: facts.alertAt })).toBe('CLOCKED_IN');
  expect(notClockedInDecision({
    ...facts, openClockIn: new Date('2026-10-04T09:50:01Z'),
  })).toBe('ALERT');
});

it.each([
  ['2026-10-04', '2026-10-04', 'APPROVED', true],
  ['2026-10-03', '2026-10-05', 'APPROVED', true],
  ['2026-10-03', '2026-10-03', 'APPROVED', false],
  ['2026-10-05', '2026-10-05', 'APPROVED', false],
  ['2026-10-04', '2026-10-04', 'PENDING', false],
] as const)('NC-Q6 excuses an overnight shift by working date: %s–%s %s', (from, to, status, excused) => {
  const shift = {
    workingDate: '2026-10-04',
    startsAt: new Date('2026-10-04T19:00:00Z'),
    endsAt: new Date('2026-10-05T03:00:00Z'),
  };
  const applied = applyApprovedLeave(shift, [{
    kind: 'FULL_DAY', status, from, to,
    startsAt: new Date('2026-10-03T21:00:00Z'),
    endsAt: new Date('2026-10-04T21:00:00Z'),
  }], 20 * 60 * 1000);
  expect(applied.excused).toBe(excused);
  expect(notClockedInDecision({
    ...facts, ...applied, now: new Date('2026-10-04T21:20:00Z'), shiftEndsAt: shift.endsAt,
  })).toBe(excused ? 'EXCUSED' : 'ALERT');
});
