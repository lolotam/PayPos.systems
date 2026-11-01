import { expect, it } from 'vitest';

import {
  candidateCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../commission-periods.ts';

it.each([
  ['2026-10-31T20:59:59.999Z', '2026-10'],
  ['2026-10-31T21:00:00.000Z', '2026-11'],
  ['2026-12-31T21:00:00.000Z', '2027-01'],
])('derives the Kuwait business month at the boundary %s', (instant, expected) => {
  expect(currentBusinessPeriod(new Date(instant), 'Asia/Kuwait')).toBe(expected);
});

it('uses the supplied timezone rather than the process timezone', () => {
  const instant = new Date('2026-11-01T02:00:00.000Z');
  expect(currentBusinessPeriod(instant, 'America/New_York')).toBe('2026-10');
});

it('expands each affected month through the current month without duplicates', () => {
  expect(candidateCommissionPeriods(['2026-10', '2026-11'], '2026-12')).toEqual([
    '2026-10',
    '2026-11',
    '2026-12',
  ]);
});

it('keeps a future affected month as its own only candidate', () => {
  expect(candidateCommissionPeriods(['2027-01'], '2026-12')).toEqual(['2027-01']);
});

it('locks the affected and candidate months together but keeps their identities separate', () => {
  expect(commissionPeriodLockPlan(['2026-11', '2026-10', '2026-11'], '2026-12')).toEqual({
    affectedPeriods: ['2026-10', '2026-11'],
    periodsToLock: ['2026-10', '2026-11', '2026-12'],
  });
});
