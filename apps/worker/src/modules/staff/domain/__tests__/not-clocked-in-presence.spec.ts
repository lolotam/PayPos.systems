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
  excused: false, deleted: false, contractEnd: null, clockIns: [], presenceSession: null,
};

it('NC-Q13 counts the OPEN 07:55 session at the 12:50 split-shift deadline', () => {
  const early = new Date('2026-10-04T04:55:00Z');
  const session = { clockIn: early, clockOut: null, status: 'OPEN' };
  expect(notClockedInDecision({ ...facts, presenceSession: session })).toBe('CLOCKED_IN');
  expect(notClockedInDecision({ ...facts, clockIns: [early] })).toBe('ALERT');
  expect(notClockedInDecision({
    ...facts, presenceSession: { ...session, clockIn: facts.alertAt },
  })).toBe('CLOCKED_IN');
  expect(notClockedInDecision({
    ...facts, presenceSession: { ...session, clockIn: new Date('2026-10-04T09:50:01Z') },
  })).toBe('ALERT');
});

it.each(['CLOSED', 'MISSED_OUT'])('NC-Q13 preserves presence when %s after alertAt before the run', (status) => {
  const presenceSession = {
    clockIn: new Date('2026-10-04T04:55:00Z'),
    clockOut: new Date('2026-10-04T09:55:00Z'),
    status,
  };
  const delayed = { ...facts, now: new Date('2026-10-04T10:00:00Z'), presenceSession };
  expect(notClockedInDecision(delayed)).toBe('CLOCKED_IN');
  for (const clockOut of [facts.alertAt, new Date('2026-10-04T09:49:59Z')]) {
    expect(notClockedInDecision({
      ...delayed, presenceSession: { ...presenceSession, clockOut },
    })).toBe('ALERT');
  }
});

it.each(['APPROVED', 'PENDING'])('BR-002 chains partial leave into %s FULL_DAY on D+1', (status) => {
  const shift = {
    workingDate: '2026-10-04',
    startsAt: new Date('2026-10-04T19:00:00Z'),
    endsAt: new Date('2026-10-05T03:00:00Z'),
  };
  const midnight = new Date('2026-10-04T21:00:00Z');
  const applied = applyApprovedLeave(shift, [{
    kind: 'FULL_DAY', status, from: '2026-10-05', to: '2026-10-05',
    startsAt: midnight, endsAt: new Date('2026-10-05T21:00:00Z'),
  }, {
    kind: 'PARTIAL', status: 'APPROVED', from: '2026-10-04', to: '2026-10-05',
    startsAt: shift.startsAt, endsAt: midnight,
  }], 20 * 60 * 1000);
  expect(applied.excused).toBe(status === 'APPROVED');
  expect(notClockedInDecision({
    ...facts, ...applied, now: new Date('2026-10-04T21:20:00Z'), shiftEndsAt: shift.endsAt,
  })).toBe(status === 'APPROVED' ? 'EXCUSED' : 'ALERT');
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
