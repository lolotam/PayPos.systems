import { expect, it } from 'vitest';

import {
  candidateCommissionPeriods,
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
  type CommissionPeriodClassification,
} from '../commission-periods.ts';
import type { LockedCommissionPeriod } from '../commission-line-types.ts';

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

const classifications: {
  readonly label: string;
  readonly locked: readonly LockedCommissionPeriod[];
  readonly affected: readonly string[];
  readonly expected: CommissionPeriodClassification;
}[] = [
  {
    label: 'classifies every affected status and leaves candidates alone',
    locked: [
      { period: '2026-12', status: 'APPROVED' },
      { period: '2026-10', status: 'DRAFT' },
      { period: '2027-01', status: 'PAID' },
      { period: '2026-11', status: 'REVIEWED' },
      { period: '2026-09', status: 'APPROVED' },
      { period: '2026-08', status: 'REVIEWED' },
    ],
    affected: ['2027-01', '2026-11', '2026-12', '2026-10'],
    expected: { closed: ['2026-12', '2027-01'], reviewed: ['2026-11'] },
  },
  {
    label: 'keeps an approved or reviewed candidate out of both lists',
    locked: [
      { period: '2026-10', status: 'DRAFT' },
      { period: '2026-11', status: 'APPROVED' },
      { period: '2026-12', status: 'REVIEWED' },
    ],
    affected: ['2026-10'],
    expected: { closed: [], reviewed: [] },
  },
  {
    label: 'splits two affected months across the closed and the reviewed list',
    locked: [
      { period: '2026-11', status: 'APPROVED' },
      { period: '2026-10', status: 'REVIEWED' },
    ],
    affected: ['2026-11', '2026-10'],
    expected: { closed: ['2026-11'], reviewed: ['2026-10'] },
  },
];

it.each(classifications)('$label', ({ locked, affected, expected }) => {
  expect(classifyCommissionPeriods(locked, affected)).toEqual(expected);
});
