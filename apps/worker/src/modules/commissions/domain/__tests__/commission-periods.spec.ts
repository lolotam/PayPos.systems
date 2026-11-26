import { describe, expect, it } from 'vitest';

import {
  candidateCommissionPeriods,
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
  MAX_CANDIDATE_COMMISSION_PERIODS,
  nextCommissionPeriodToLock,
  type CommissionPeriodClassification,
} from '../commission-periods.ts';
import type { LockedCommissionPeriod } from '../commission-line-types.ts';
import { salaryAffectedPeriods } from '../commission-tip-salary-periods.ts';
import { CommissionCandidateRangeExceededError, CommissionPeriodInvalidError } from '../errors.ts';

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

it('walks from a second closed affected month after an earlier open affected month', () => {
  const run = lockRun(['2024-01', '2026-06'], '2026-12', {
    '2024-01': 'DRAFT',
    '2026-06': 'APPROVED',
    '2026-07': 'DRAFT',
  });
  expect(run.requested).toEqual(['2024-01', '2026-06', '2026-07']);
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

describe('the candidate range of a commission statement period', () => {
  it('takes a hundred and twenty months and refuses a hundred and twenty one', () => {
    // الحد الأقصى عشر سنوات: النطاق الأطول بيرفض قبل أي قفل، مش بعد ما ياخد أقفال بلا نهاية.
    const first = '2016-02';
    const hundred = '2026-01';
    const hundredAndOne = '2026-02';

    expect(candidateCommissionPeriods([first], hundred)).toHaveLength(
      MAX_CANDIDATE_COMMISSION_PERIODS,
    );
    expect(() => candidateCommissionPeriods([first], hundredAndOne)).toThrow(
      CommissionCandidateRangeExceededError,
    );
    expect(() => candidateCommissionPeriods([first], hundredAndOne)).toThrow(
      expect.objectContaining({ code: 'COMMISSION_CANDIDATE_RANGE_EXCEEDED' }),
    );
  });

  it('refuses the range before the lock plan is built', () => {
    expect(() => commissionPeriodLockPlan(['2016-01'], '2026-02')).toThrow(
      CommissionCandidateRangeExceededError,
    );
  });

  it('refuses a month that is not a calendar month instead of looping for ever', () => {
    expect(() => candidateCommissionPeriods(['2026-13'], '2026-12')).toThrow(
      CommissionPeriodInvalidError,
    );
    expect(() => candidateCommissionPeriods(['2026-01'], '2026-13')).toThrow(
      CommissionPeriodInvalidError,
    );
    expect(() => nextCommissionPeriodToLock(['2026-13'], '2026-12', [])).toThrow(
      CommissionPeriodInvalidError,
    );
  });

  it('stops the month-by-month correction walk at the maximum', () => {
    // الشهر المقفول بلا هدف مفتوح بيمشي شهر شهر، فلو وصل الحد بيرفض قبل قفل تاني.
    const closed: LockedCommissionPeriod[] = Array.from(
      { length: MAX_CANDIDATE_COMMISSION_PERIODS },
      (_row, index) => {
        const year = 2016 + Math.floor(index / 12);
        const month = (index % 12) + 1;
        return {
          period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
          statementId: `statement-${index}`,
          status: 'APPROVED' as const,
        };
      },
    );

    expect(() => nextCommissionPeriodToLock(['2016-01'], '2030-01', closed)).toThrow(
      CommissionCandidateRangeExceededError,
    );
  });
});

describe('the union of the affected months of a commission statement period', () => {
  it('counts the union of two affected months, not the months of each one', () => {
    // الشهران المتأثران جوّه المدى بعض: الاتحاد 120 شهر، والتكرار ما بيعملش رفض.
    expect(candidateCommissionPeriods(['2016-02', '2016-03'], '2026-01')).toHaveLength(
      MAX_CANDIDATE_COMMISSION_PERIODS,
    );
    expect(commissionPeriodLockPlan(['2016-02', '2016-03'], '2026-01').periodsToLock).toHaveLength(
      MAX_CANDIDATE_COMMISSION_PERIODS,
    );
    expect(() => candidateCommissionPeriods(['2016-01', '2016-02'], '2026-01')).toThrow(
      CommissionCandidateRangeExceededError,
    );
  });

  it('takes the salary months of the same span without refusing the plan', () => {
    // نفس المدى من ناحية الراتب: الشهور المتأثرة 120، وخطة القفل بتقبلها زي ما هي.
    const affected = salaryAffectedPeriods('2016-02-01', null, '2026-01', '2016-02');
    expect(affected).toHaveLength(MAX_CANDIDATE_COMMISSION_PERIODS);
    expect(commissionPeriodLockPlan(affected, '2026-01').periodsToLock).toHaveLength(
      MAX_CANDIDATE_COMMISSION_PERIODS,
    );
  });
});
