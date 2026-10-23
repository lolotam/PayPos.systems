import { expect, it } from 'vitest';

import { computeMarginalTierNumerator } from '../marginal-tiers.ts';
import type { CommissionCalc, CommissionPricingLine, AmountTierStep } from '../commission-types.ts';

const pct = (value: bigint): CommissionCalc => ({ kind: 'PCT', value });
const fixed = (value: bigint): CommissionCalc => ({ kind: 'FIXED', value });
const step = (from: bigint, calc: CommissionCalc): AmountTierStep => ({ from, calc });
const line = (netShare: bigint, counts = true, shareBps = 10000n): CommissionPricingLine => ({
  netShare,
  counts,
  shareBps,
});

it.each([
  ['no steps', 0n, 100n, [], 0n],
  ['below first', 0n, 499999n, [step(500000n, pct(500n))], 0n],
  ['ends at first', 0n, 500000n, [step(500000n, pct(500n))], 0n],
  ['owner C7', 0n, 1000000n, [step(500000n, pct(500n))], 250000000n],
  ['starts at first', 500000n, 100000n, [step(500000n, pct(500n))], 50000000n],
  ['crosses two PCT steps', 0n, 300n, [step(100n, pct(500n)), step(200n, pct(1000n))], 150000n],
  [
    'replaces previous PCT',
    200n,
    100n,
    [step(0n, pct(500n)), step(100n, pct(1000n)), step(200n, pct(2000n))],
    200000n,
  ],
  [
    'zero net at active FIXED',
    100n,
    0n,
    [step(0n, pct(500n)), step(100n, fixed(2000n))],
    20000000n,
  ],
] as const)('CE1-MARGINAL %s', (_name, x, share, steps, expected) => {
  expect(computeMarginalTierNumerator(line(share), steps, x)).toBe(expected);
});

const endpointSteps = [step(0n, pct(500n)), step(50000n, pct(1000n)), step(100000n, fixed(2000n))];

it.each([
  [59999n, 54_999_000n],
  [60000n, 55_000_000n],
  [60001n, 30_000_500n],
] as const)('CE1-MARGINAL half-open FIXED endpoint, share %s', (share, expected) => {
  expect(computeMarginalTierNumerator(line(share), endpointSteps, 40000n)).toBe(expected);
});

it.each([
  ['PCT to FIXED', [step(0n, pct(500n)), step(100n, fixed(2000n))], 50n, 100n, 50000n],
  ['FIXED to PCT', [step(0n, fixed(2000n)), step(100n, pct(1000n))], 50n, 100n, 20000000n],
  ['below first FIXED', [step(100n, fixed(2000n))], 50n, 100n, 0n],
  ['starts at FIXED', [step(100n, fixed(2000n))], 100n, 1n, 20000000n],
  ['FIXED ends at PCT', [step(0n, fixed(2000n)), step(100n, pct(1000n))], 50n, 50n, 20000000n],
  [
    'FIXED in middle',
    [step(0n, pct(500n)), step(100n, fixed(2000n)), step(200n, pct(1000n))],
    50n,
    250n,
    125000n,
  ],
] as const)(
  'CE1-MARGINAL %s keeps the previous step for this whole line',
  (_name, steps, x, share, expected) => {
    expect(computeMarginalTierNumerator(line(share), steps, x)).toBe(expected);
  },
);

it('CE1-MARGINAL an excluded line uses only the step before it', () => {
  expect(computeMarginalTierNumerator(line(60000n, false), endpointSteps, 40000n)).toBe(30000000n);
  expect(computeMarginalTierNumerator(line(1000000n, false), [step(500000n, pct(500n))], 0n)).toBe(
    0n,
  );
});

it('CE1-MARGINAL scales a FIXED step by performer bps, even with zero net', () => {
  const steps = Object.freeze([Object.freeze(step(0n, Object.freeze(fixed(2001n))))]);
  expect(computeMarginalTierNumerator(Object.freeze(line(0n, true, 5000n)), steps, 0n)).toBe(
    10005000n,
  );
});
