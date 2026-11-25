import { expect, it } from 'vitest';

import {
  candidateCommissionPeriods,
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
  nextCommissionPeriodToLock,
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
    affected: ['9999-11'],
    current: '9999-12',
    expected: ['9999-11', '9999-12'],
  },
  {
    affected: ['2026-12', '2026-11'],
    current: '2027-01',
    expected: ['2026-11', '2026-12', '2027-01'],
  },
])(
  'returns the exact candidates for $affected through $current',
  ({ affected, current, expected }) => {
    expect(candidateCommissionPeriods(affected, current)).toEqual(expected);
  },
);

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
      { period: '2026-12', statementId: 'statement-2026-12', status: 'APPROVED' },
      { period: '2026-10', statementId: 'statement-2026-10', status: 'DRAFT' },
      { period: '2027-01', statementId: 'statement-2027-01', status: 'PAID' },
      { period: '2026-11', statementId: 'statement-2026-11', status: 'REVIEWED' },
      { period: '2026-09', statementId: 'statement-2026-09', status: 'APPROVED' },
      { period: '2026-08', statementId: 'statement-2026-08', status: 'REVIEWED' },
    ],
    affected: ['2027-01', '2026-11', '2026-12', '2026-10'],
    expected: { closed: ['2026-12', '2027-01'], reviewed: ['2026-11'] },
  },
  {
    label: 'keeps an approved or reviewed candidate out of both lists',
    locked: [
      { period: '2026-10', statementId: 'statement-2026-10', status: 'DRAFT' },
      { period: '2026-11', statementId: 'statement-2026-11', status: 'APPROVED' },
      { period: '2026-12', statementId: 'statement-2026-12', status: 'REVIEWED' },
    ],
    affected: ['2026-10'],
    expected: { closed: [], reviewed: [] },
  },
  {
    label: 'splits two affected months across the closed and the reviewed list',
    locked: [
      { period: '2026-11', statementId: 'statement-2026-11', status: 'APPROVED' },
      { period: '2026-10', statementId: 'statement-2026-10', status: 'REVIEWED' },
    ],
    affected: ['2026-11', '2026-10'],
    expected: { closed: ['2026-11'], reviewed: ['2026-10'] },
  },
];

it.each(classifications)('$label', ({ locked, affected, expected }) => {
  expect(classifyCommissionPeriods(locked, affected)).toEqual(expected);
});

/** حالة قفل شهر واحد: DRAFT أو REVIEWED أو APPROVED أو PAID. */
type LockStatus = LockedCommissionPeriod['status'];

/**
 * يحاكي دورة القفل الحقيقية: بيقفل الشهر اللي الاختيار بيوصله ويكمّل لحد ما الاختيار
 * يقف، فالاختبار بيشوف كل نداءات القفل مش بس أول خطوة.
 */
function lockRun(
  affected: readonly string[],
  currentPeriod: string,
  statuses: Readonly<Record<string, LockStatus>>,
): { readonly requested: string[]; readonly locked: LockedCommissionPeriod[] } {
  const requested: string[] = [];
  const locked: LockedCommissionPeriod[] = [];
  for (;;) {
    const next = nextCommissionPeriodToLock(affected, currentPeriod, locked);
    if (next === null) break;
    requested.push(next);
    locked.push({
      period: next,
      statementId: `statement-${next}`,
      status: statuses[next] ?? 'DRAFT',
    });
  }
  return { requested, locked };
}

it('locks nothing when no month is affected', () => {
  expect(nextCommissionPeriodToLock([], '2026-12', [])).toBeNull();
});

it('locks one open historical month and stops instead of walking to the current month', () => {
  const run = lockRun(['0001-01'], '2026-12', { '0001-01': 'DRAFT' });
  expect(run.requested).toEqual(['0001-01']);
  expect(nextCommissionPeriodToLock(['0001-01'], '2026-12', run.locked)).toBeNull();
});

it('steps month by month from a closed historical month until the first open target', () => {
  const run = lockRun(['2024-01'], '2024-06', {
    '2024-01': 'APPROVED',
    '2024-02': 'REVIEWED',
    '2024-03': 'APPROVED',
    '2024-04': 'PAID',
    '2024-05': 'DRAFT',
  });
  expect(run.requested).toEqual(['2024-01', '2024-02', '2024-03', '2024-04', '2024-05']);
  expect(nextCommissionPeriodToLock(['2024-01'], '2024-06', run.locked)).toBeNull();
});

it('skips the open months between two affected months', () => {
  const run = lockRun(['2024-01', '2026-06'], '2026-12', { '2024-01': 'DRAFT' });
  expect(run.requested).toEqual(['2024-01', '2026-06']);
});

it('walks from a closed affected month to its first open target and then jumps to the next affected month', () => {
  const run = lockRun(['2024-01', '2026-06'], '2026-12', {
    '2024-01': 'APPROVED',
    '2024-02': 'REVIEWED',
    '2024-03': 'DRAFT',
  });
  expect(run.requested).toEqual(['2024-01', '2024-02', '2024-03', '2026-06']);
  expect(nextCommissionPeriodToLock(['2024-01', '2026-06'], '2026-12', run.locked)).toBeNull();
});

it('stops at the current month when no open target is left for the closed month', () => {
  const run = lockRun(['2024-01'], '2024-03', {
    '2024-01': 'APPROVED',
    '2024-02': 'APPROVED',
    '2024-03': 'APPROVED',
  });
  expect(run.requested).toEqual(['2024-01', '2024-02', '2024-03']);
  expect(nextCommissionPeriodToLock(['2024-01'], '2024-03', run.locked)).toBeNull();
});

it('locks only the affected month when it is newer than the current month', () => {
  const run = lockRun(['2027-01'], '2026-12', { '2027-01': 'APPROVED' });
  expect(run.requested).toEqual(['2027-01']);
});
