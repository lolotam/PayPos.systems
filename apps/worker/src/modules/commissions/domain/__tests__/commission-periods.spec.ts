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

it.each([
  {
    affected: ['2026-11'],
    current: '2027-02',
    expected: ['2026-11', '2026-12', '2027-01', '2027-02'],
  },
  {
    affected: ['2026-12'],
    current: '2027-01',
    expected: ['2026-12', '2027-01'],
  },
  {
    affected: ['2027-01'],
    current: '2027-01',
    expected: ['2027-01'],
  },
  {
    affected: ['2027-01'],
    current: '2026-12',
    expected: ['2027-01'],
  },
  {
    affected: ['2026-12', '2026-11'],
    current: '2027-01',
    expected: ['2026-11', '2026-12', '2027-01'],
  },
])('returns the exact candidates for $affected through $current', ({ affected, current, expected }) => {
  expect(candidateCommissionPeriods(affected, current)).toEqual(expected);
});

it('locks the full ascending range while returning only affected months as affected', () => {
  expect(commissionPeriodLockPlan(['2026-12', '2026-11', '2026-12'], '2027-02')).toEqual({
    affectedPeriods: ['2026-11', '2026-12'],
    periodsToLock: ['2026-11', '2026-12', '2027-01', '2027-02'],
  });
});
