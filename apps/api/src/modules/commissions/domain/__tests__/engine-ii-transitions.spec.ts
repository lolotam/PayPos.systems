import { expect, it, vi } from 'vitest';
import * as kernel from '@pospay/domain';

import { computeFollowPlanLine } from '../line-commission.ts';
import { allocateLineShares } from '../line-shares.ts';
import { computePeriod } from '../period-commission.ts';
import { selectCommissionPlanVersion } from '../plan-version.ts';
import { resolveCommissionPlan } from '../salary-thresholds.ts';
import { fixed, line, pct, period, sale, version } from './engine-ii-fixtures.ts';

it('changing accumulator type uses the whole period history, including standalone rules', () => {
  const amount = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'AMOUNT', value: 100000n }, calc: pct(1000n) }],
    },
  });
  const sessions = version({
    effectiveFrom: '2026-10-20',
    createdAt: 2n,
    version: 2n,
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'SESSIONS',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'SESSIONS', value: 2n }, calc: fixed(2000n) }],
    },
  });
  // a المستقل 100000 × 5% = 5000؛ b عند 100000 يعطي 10000؛ c عند جلستين يعطي 2000.
  const lines = [
    line({ ruleSnapshot: pct(500n) }),
    line({ lineId: 'b', occurredAt: 2n }),
    line({ lineId: 'c', occurredAt: 3n, businessDate: '2026-10-20' }),
  ];
  expect(computePeriod(period({ lines, versions: [amount, sessions] }))).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 5000n],
      ['line:b', 10000n],
      ['line:c', 2000n],
    ]),
    total: 17000n,
  });
});

it('WHOLE final accumulator spans versions but each source retains its selected version calc', () => {
  const tiers = {
    enabled: true,
    accumulator: 'SESSIONS',
    mode: 'WHOLE',
    steps: [{ from: { kind: 'SESSIONS', value: 2n }, calc: pct(1000n) }],
  } as const;
  const changed = version({
    effectiveFrom: '2026-10-20',
    createdAt: 2n,
    version: 2n,
    base: { enabled: false },
    tiers: { ...tiers, steps: [{ from: { kind: 'SESSIONS', value: 2n }, calc: pct(2000n) }] },
  });
  // النهائي جلستان؛ القديم 100000 × 10% = 10000 والجديد 100000 × 20% = 20000.
  expect(
    computePeriod(
      period({
        lines: [line(), line({ lineId: 'b', occurredAt: 2n, businessDate: '2026-10-20' })],
        versions: [version({ base: { enabled: false }, tiers }), changed],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 10000n],
      ['line:b', 20000n],
    ]),
    total: 30000n,
  });
});

it('a shared line contributes one session independently to each performer', () => {
  // صافي 7: الأنصبة 4 و3؛ عند WHOLE حد جلسة و100%، كل مؤدية تكسب نصيبها كاملاً.
  const shares = allocateLineShares(7n, [
    { employeeId: 'employee-b', shareBps: 5000n },
    { employeeId: 'employee-a', shareBps: 5000n },
  ]);
  for (const [employeeId, expected] of [
    ['employee-a', 4n],
    ['employee-b', 3n],
  ] as const) {
    const result = computePeriod(
      period({
        employeeId,
        lines: [line({ employeeId, netShare: shares.get(employeeId) ?? 0n, shareBps: 5000n })],
        versions: [
          version({
            employeeId,
            base: { enabled: false },
            tiers: {
              enabled: true,
              accumulator: 'SESSIONS',
              mode: 'WHOLE',
              steps: [{ from: { kind: 'SESSIONS', value: 1n }, calc: pct(10000n) }],
            },
          }),
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      perSource: new Map([['line:a', expected]]),
      total: expected,
    });
  }
});

it('createdAt outranks effectiveFrom rather than treating plan versions as date-sorted', () => {
  const latestDate = version({ effectiveFrom: '2026-10-15', createdAt: 1n });
  const latestCreation = version({ effectiveFrom: '2026-10-05', createdAt: 2n });
  expect(
    selectCommissionPlanVersion('employee-a', '2026-10-20', [latestDate, latestCreation]),
  ).toBe(latestCreation);
});

it('missing plan after successfully priced sources returns no partial payout', () => {
  const input = period({
    versions: [],
    lines: [line({ ruleSnapshot: pct(1000n) })],
    sales: [sale()],
  });
  expect(computePeriod(input)).toEqual({ ok: false, code: 'NO_PLAN' });
});

it.each([
  // من x=11: (1251.25 − 11) × 5% + (2011 − 1251.25) × 10% = 137.9875 → 138.
  [pct(500n), pct(1000n), 138n],
  // لمس FIXED الجديد يثبت نسبة القديم لكل البند: 2000 × 5% = 100.
  [pct(500n), fixed(500n), 100n],
  // لمس FIXED القديم يثبت الثابت: 500 × نصف الحصة = 250.
  [fixed(500n), pct(1000n), 250n],
] as const)('salary-scaled MARGINAL crossing %o → %o rounds once', (first, second, expected) => {
  const plan = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        { from: { kind: 'SALARY_MULTIPLE', value: 1n }, calc: first },
        { from: { kind: 'SALARY_MULTIPLE', value: 125n }, calc: second },
      ],
    },
  });
  const resolved = resolveCommissionPlan(plan, 1001n);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  const spy = vi.spyOn(kernel, 'roundKwd');
  try {
    expect(
      computeFollowPlanLine(line({ netShare: 2000n, shareBps: 5000n }), resolved.plan, 11n),
    ).toBe(expected);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('WHOLE signed half mills mirror each other through the selected-plan seam', () => {
  const plan = {
    base: { enabled: true, calc: pct(2500n) },
    tiers: {
      enabled: true,
      mode: 'WHOLE',
      accumulator: 'SESSIONS',
      steps: [{ from: 1n, calc: pct(2500n) }],
    },
  } as const;
  // ±1 × (25% + 25%) = ±0.5؛ التقريب بعيداً عن الصفر يعطي ±1 فلس.
  expect(computeFollowPlanLine(line({ netShare: 1n }), plan, 0n, 1n)).toBe(1n);
  expect(computeFollowPlanLine(line({ netShare: -1n }), plan, 0n, 1n)).toBe(-1n);
});
