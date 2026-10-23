import { expect, it } from 'vitest';

import { advanceAmountAccumulator } from '../amount-accumulator.ts';
import type {
  CommissionLineOrder,
  CommissionPricingLine,
  MarginalAmountPlan,
  ServiceCommissionRule,
} from '../commission-types.ts';
import { computeLineCommission } from '../line-commission.ts';
import { orderCommissionLines } from '../line-order.ts';
import { allocateLineShares } from '../line-shares.ts';

type PricedLine = CommissionLineOrder &
  CommissionPricingLine & {
    readonly rule: ServiceCommissionRule;
    readonly plan: MarginalAmountPlan;
  };
const plan: MarginalAmountPlan = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [{ from: 500000n, calc: { kind: 'PCT', value: 500n } }],
  },
};
const row = (
  lineId: string,
  occurredAt: bigint,
  netShare: bigint,
  patch: Partial<PricedLine> = {},
): PricedLine => ({
  lineId,
  occurredAt,
  recordedAt: occurredAt,
  netShare,
  shareBps: 10000n,
  counts: true,
  rule: { kind: 'FOLLOW_PLAN' },
  plan,
  ...patch,
});

// محاكاة تركيب الدوال فقط؛ اختيار الفترة والإصدار وcomputePeriod يظلان خارج PR 29.
function priceSequence(lines: readonly PricedLine[]) {
  let accumulator = 0n;
  const amounts = new Map<string, bigint>();
  for (const line of orderCommissionLines(lines)) {
    const result = computeLineCommission(line, line.rule, line.plan, accumulator);
    if (!result.ok) throw new Error(result.code);
    amounts.set(line.lineId, result.amount);
    accumulator = advanceAmountAccumulator(accumulator, line);
  }
  return {
    amounts,
    accumulator,
    total: [...amounts.values()].reduce((sum, amount) => sum + amount, 0n),
  };
}

it.each([
  { kind: 'ZERO' },
  { kind: 'PCT', value: 1000n },
  { kind: 'FIXED', value: 1000n },
] satisfies ServiceCommissionRule[])(
  'CE1-AMOUNT counted override %o still advances the next FOLLOW_PLAN tier',
  (rule) => {
    const result = priceSequence([row('a', 1n, 600000n, { rule }), row('b', 2n, 400000n)]);
    expect(result.amounts.get('b')).toBe(20000n);
    expect(result.accumulator).toBe(1000000n);
  },
);

it('CE1-AMOUNT excluded lines earn at position but do not move later tiers', () => {
  const result = priceSequence([
    row('a', 1n, 600000n),
    row('excluded', 2n, 400000n, { counts: false }),
    row('b', 3n, 400000n),
  ]);
  expect(result.amounts).toEqual(
    new Map([
      ['a', 5000n],
      ['excluded', 20000n],
      ['b', 20000n],
    ]),
  );
  expect(result.accumulator).toBe(1000000n);
});

it('CE1-AMOUNT keeps the period accumulator when the caller supplies a different plan', () => {
  const changed: MarginalAmountPlan = {
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: 500000n, calc: { kind: 'PCT', value: 1000n } }],
    },
  };
  const result = priceSequence([row('a', 1n, 600000n), row('b', 2n, 400000n, { plan: changed })]);
  expect(result.amounts).toEqual(
    new Map([
      ['a', 5000n],
      ['b', 40000n],
    ]),
  );
});

it('CE1-MARGINAL a FIXED crossing keeps old PCT; the next line uses FIXED', () => {
  const selected: MarginalAmountPlan = {
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        { from: 0n, calc: { kind: 'PCT', value: 500n } },
        { from: 100000n, calc: { kind: 'FIXED', value: 2000n } },
      ],
    },
  };
  const result = priceSequence([
    row('a', 1n, 60000n, { plan: selected }),
    row('b', 2n, 60000n, { plan: selected }),
    row('c', 3n, 10000n, { plan: selected }),
  ]);
  expect(result.amounts).toEqual(
    new Map([
      ['a', 3000n],
      ['b', 3000n],
      ['c', 2000n],
    ]),
  );
});

it('CE1-ORDER permutations converge and a late earlier insertion reprices later estimates', () => {
  const later = Object.freeze(row('b', 2n, 400000n));
  const earlier = Object.freeze(row('a', 1n, 600000n, { recordedAt: 99n }));
  expect(priceSequence([later]).amounts.get('b')).toBe(0n);
  const result = priceSequence(Object.freeze([later, earlier]));
  expect(result.amounts).toEqual(
    new Map([
      ['a', 5000n],
      ['b', 20000n],
    ]),
  );
  expect(priceSequence([earlier, later])).toEqual(result);
});

it('CE1-SHARES amount thresholds use allocated net share; FIXED uses original performer bps', () => {
  const shares = allocateLineShares(1n, [
    { employeeId: 'a', shareBps: 5000n },
    { employeeId: 'b', shareBps: 5000n },
  ]);
  expect(
    computeLineCommission(
      row('a', 1n, shares.get('a') ?? 0n, { shareBps: 5000n }),
      { kind: 'PCT', value: 5000n },
      null,
      0n,
    ),
  ).toEqual({ ok: true, amount: 1n });
  expect(
    computeLineCommission(
      row('b', 1n, shares.get('b') ?? 0n, { shareBps: 5000n }),
      { kind: 'FIXED', value: 1n },
      null,
      0n,
    ),
  ).toEqual({ ok: true, amount: 1n });
});

it('CE1-ROUND totals sum rounded lines instead of rounding the raw period sum', () => {
  const tiny: MarginalAmountPlan = {
    base: { enabled: true, calc: { kind: 'PCT', value: 5000n } },
    tiers: { enabled: false },
  };
  expect(
    priceSequence([row('a', 1n, 1n, { plan: tiny }), row('b', 2n, 1n, { plan: tiny })]).total,
  ).toBe(2n);
});
