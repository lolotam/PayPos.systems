import { expect, it, vi } from 'vitest';
import * as kernel from '@pospay/domain';

import { advanceAmountAccumulator } from '../amount-accumulator.ts';
import { computeCalcNumerator } from '../commission-calc.ts';
import type {
  CommissionCalc,
  CommissionPricingLine,
  MarginalAmountPlan,
  ServiceCommissionRule,
} from '../commission-types.ts';
import { computeFollowPlanLine, computeLineCommission } from '../line-commission.ts';

const line = (netShare = 100000n, shareBps = 10000n, counts = true): CommissionPricingLine => ({
  netShare,
  shareBps,
  counts,
});
const pct = (value: bigint): CommissionCalc => ({ kind: 'PCT', value });
const fixed = (value: bigint): CommissionCalc => ({ kind: 'FIXED', value });
const plan: MarginalAmountPlan = {
  base: { enabled: true, calc: pct(100n) },
  tiers: {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [{ from: 0n, calc: pct(500n) }],
  },
};

it.each([
  [false, false, 0n],
  [true, false, 1000n],
  [false, true, 5000n],
  [true, true, 6000n],
] as const)('CE1-PLAN independent switches base=%s tiers=%s', (base, tiers, expected) => {
  const selected: MarginalAmountPlan = {
    base: base ? plan.base : { enabled: false },
    tiers: tiers ? plan.tiers : { enabled: false },
  };
  expect(computeFollowPlanLine(Object.freeze(line()), Object.freeze(selected), 0n)).toBe(expected);
});

it.each([
  [pct(500n), 2500n],
  [fixed(2000n), 1000n],
] as const)('CE1-PLAN base %o scales by the correct share', (calc, expected) => {
  expect(
    computeFollowPlanLine(
      line(50000n, 5000n),
      { base: { enabled: true, calc }, tiers: { enabled: false } },
      0n,
    ),
  ).toBe(expected);
});

it('CE1-ROUND adds exact base and tier fractions before rounding once', () => {
  // الأساسي 0.25 فلس + الشريحة 0.25 فلس = نصف فلس، وليس مجموع صفرين مقربين.
  const tiny: MarginalAmountPlan = {
    base: { enabled: true, calc: pct(2500n) },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: 0n, calc: pct(2500n) }],
    },
  };
  expect(computeFollowPlanLine(line(1n), tiny, 0n)).toBe(1n);
});

it('CE1-ROUND accumulates multiple fractional tier parts before one rounding', () => {
  const tiny: MarginalAmountPlan = {
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        { from: 0n, calc: pct(2500n) },
        { from: 1n, calc: pct(2500n) },
      ],
    },
  };
  expect(computeFollowPlanLine(line(2n), tiny, 0n)).toBe(1n);
});

it.each([
  [{ kind: 'ZERO' }, 0n],
  [{ kind: 'PCT', value: 500n }, 2500n],
  [{ kind: 'FIXED', value: 2000n }, 1000n],
  [{ kind: 'FOLLOW_PLAN' }, 3000n],
] satisfies [ServiceCommissionRule, bigint][])(
  'CE1-RULE %o replaces both plan parts unless FOLLOW_PLAN',
  (rule, amount) => {
    expect(computeLineCommission(line(50000n, 5000n), rule, plan, 0n)).toEqual({
      ok: true,
      amount,
    });
  },
);

it.each([0n, 1n, 100000n])('CE1-PLAN missing plan for share %s is NO_PLAN', (netShare) => {
  expect(computeLineCommission(line(netShare), { kind: 'FOLLOW_PLAN' }, null, 0n)).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
});

it.each([
  [{ kind: 'ZERO' }, 0n],
  [{ kind: 'PCT', value: 5000n }, 1n],
  [{ kind: 'FIXED', value: 1n }, 1n],
] satisfies [ServiceCommissionRule, bigint][])(
  'CE1-ROUND override %o needs no plan, including half mills',
  (rule, amount) => {
    expect(computeLineCommission(line(1n, 5000n), rule, null, 0n)).toEqual({ ok: true, amount });
  },
);

it.each([
  [1n, 4999n, 0n],
  [1n, 5000n, 1n],
  [1n, 5001n, 1n],
  [-1n, 4999n, 0n],
  [-1n, 5000n, -1n],
  [-1n, 5001n, -1n],
] as const)('CE1-ROUND signed PCT %s × %s bps', (netShare, bps, amount) => {
  expect(computeLineCommission(line(netShare), pct(bps), null, 0n)).toEqual({ ok: true, amount });
  expect(
    computeFollowPlanLine(
      line(netShare),
      { base: { enabled: true, calc: pct(bps) }, tiers: { enabled: false } },
      0n,
    ),
  ).toBe(amount);
});

it.each(['ZERO', 'PCT', 'FIXED', 'FOLLOW_PLAN'] as const)(
  'CE1-ROUND %s calls shared roundKwd exactly once',
  (kind) => {
    const spy = vi.spyOn(kernel, 'roundKwd');
    try {
      const rule: ServiceCommissionRule =
        kind === 'PCT' || kind === 'FIXED' ? { kind, value: 1n } : { kind };
      computeLineCommission(line(1n, 5000n), rule, plan, 0n);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  },
);

it('CE1-PLAN adds a FIXED base to the active FIXED tier without intermediate rounding', () => {
  const selected: MarginalAmountPlan = {
    base: { enabled: true, calc: fixed(1n) },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: 0n, calc: fixed(1n) }],
    },
  };
  expect(computeFollowPlanLine(line(0n, 5000n), selected, 0n)).toBe(1n);
});

it('CE1-AMOUNT advances only counted shares after pricing, never mutating input', () => {
  expect(advanceAmountAccumulator(100n, Object.freeze(line(50n, 5000n, true)))).toBe(150n);
  expect(advanceAmountAccumulator(100n, Object.freeze(line(50n, 5000n, false)))).toBe(100n);
  expect(advanceAmountAccumulator(100n, line(0n))).toBe(100n);
  expect(advanceAmountAccumulator(99_999_999_999_999n, line(99_999_999_999_999n))).toBe(
    199_999_999_999_998n,
  );
});

it('CE1-ROUND computes exact bigint numerators without losing large values', () => {
  expect(computeCalcNumerator(pct(5000n), line(99_999_999_999_999n))).toBe(
    499_999_999_999_995_000n,
  );
  expect(computeCalcNumerator(fixed(2001n), line(10000n, 5000n))).toBe(10_005_000n);
});
