import { expect, it } from 'vitest';

import { validateCommissionPlan } from '../plan-validation.ts';
import { fixed, pct, version } from './engine-ii-fixtures.ts';

const allowed = [
  ['AMOUNT', 'AMOUNT', 0n],
  ['AMOUNT', 'SALARY_MULTIPLE', 1n],
  ['SESSIONS', 'SESSIONS', 0n],
] as const;

const combinations = allowed.flatMap(([accumulator, kind, from]) =>
  ['MARGINAL', 'WHOLE'].flatMap((mode) =>
    [false, true].flatMap((base) =>
      [false, true].flatMap((tiers) =>
        [false, true].flatMap((packageSale) =>
          [pct(0n), pct(10000n), fixed(0n), fixed(2000n)].map((calc) => ({
            accumulator,
            kind,
            from,
            mode,
            base,
            tiers,
            packageSale,
            calc,
          })),
        ),
      ),
    ),
  ),
);

it.each(combinations)(
  'accepts §5.7 $accumulator/$kind/$mode switches $base/$tiers/$packageSale/$calc.kind',
  (row) => {
    expect(
      validateCommissionPlan({
        base: { enabled: row.base, calc: row.calc },
        packageSale: { enabled: row.packageSale, calc: row.calc },
        tiers: {
          enabled: row.tiers,
          mode: row.mode,
          accumulator: row.accumulator,
          steps: [
            { from: { kind: row.kind, value: row.from }, calc: pct(1000n) },
            { from: { kind: row.kind, value: row.from + 1n }, calc: fixed(2000n) },
            { from: { kind: row.kind, value: row.from + 2n }, calc: pct(10000n) },
          ],
        },
      }),
    ).toEqual({ ok: true });
  },
);

const invalidPairs = ['AMOUNT', 'SESSIONS', 'OTHER'].flatMap((accumulator) =>
  ['AMOUNT', 'SALARY_MULTIPLE', 'SESSIONS']
    .filter((kind) => !allowed.some(([a, k]) => a === accumulator && k === kind))
    .map((kind) => ({ accumulator, kind })),
);

it.each(invalidPairs)(
  'rejects forbidden $accumulator/$kind combination',
  ({ accumulator, kind }) => {
    expect(
      validateCommissionPlan({
        ...version(),
        tiers: {
          enabled: true,
          mode: 'WHOLE',
          accumulator,
          steps: [{ from: { kind, value: 1n }, calc: pct(1000n) }],
        },
      }),
    ).toEqual({ ok: false, code: 'INVALID_COMBINATION' });
  },
);

const validTiers = {
  enabled: true,
  accumulator: 'AMOUNT',
  mode: 'MARGINAL',
  steps: [{ from: { kind: 'AMOUNT', value: 0n }, calc: pct(1000n) }],
};

it.each([
  [null, 'INVALID_PLAN'],
  [{}, 'INVALID_PLAN'],
  [{ ...version(), base: { enabled: 'true' } }, 'INVALID_PLAN'],
  [{ ...version(), base: { enabled: true } }, 'INVALID_CALC'],
  [
    { ...version(), packageSale: { enabled: true, calc: { kind: 'OTHER', value: 1n } } },
    'INVALID_CALC',
  ],
  [{ ...version(), tiers: { ...validTiers, mode: 'OTHER' } }, 'INVALID_COMBINATION'],
  [{ ...version(), tiers: { ...validTiers, accumulator: 'toString' } }, 'INVALID_COMBINATION'],
  [{ ...version(), tiers: { ...validTiers, steps: [] } }, 'NO_STEPS'],
  [{ ...version(), tiers: { ...validTiers, steps: null } }, 'INVALID_PLAN'],
  [
    {
      ...version(),
      tiers: { ...validTiers, steps: [{ from: { kind: 'OTHER', value: 1n }, calc: pct(1n) }] },
    },
    'INVALID_THRESHOLD',
  ],
  [
    {
      ...version(),
      tiers: {
        ...validTiers,
        steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 0n }, calc: pct(1n) }],
      },
    },
    'INVALID_THRESHOLD',
  ],
  [
    {
      ...version(),
      tiers: { ...validTiers, steps: [{ from: { kind: 'AMOUNT', value: -1n }, calc: pct(1n) }] },
    },
    'INVALID_THRESHOLD',
  ],
  [
    {
      ...version(),
      tiers: {
        ...validTiers,
        accumulator: 'SESSIONS',
        steps: [{ from: { kind: 'SESSIONS', value: 1.5 }, calc: pct(1n) }],
      },
    },
    'INVALID_THRESHOLD',
  ],
  [
    {
      ...version(),
      tiers: {
        ...validTiers,
        steps: [
          validTiers.steps[0],
          { from: { kind: 'SALARY_MULTIPLE', value: 1n }, calc: pct(1n) },
        ],
      },
    },
    'MIXED_THRESHOLDS',
  ],
  [
    { ...version(), tiers: { ...validTiers, steps: [validTiers.steps[0], validTiers.steps[0]] } },
    'STEPS_NOT_ASCENDING',
  ],
  [
    {
      ...version(),
      tiers: {
        ...validTiers,
        steps: [{ from: { kind: 'AMOUNT', value: 1n }, calc: pct(1n) }, validTiers.steps[0]],
      },
    },
    'STEPS_NOT_ASCENDING',
  ],
] as const)('rejects invalid plan %o with %s', (plan, code) => {
  expect(validateCommissionPlan(plan)).toEqual({ ok: false, code });
});

it.each([
  { kind: 'PCT', value: -1n },
  { kind: 'PCT', value: 10001n },
  { kind: 'PCT', value: 0.5 },
  { kind: 'FIXED', value: -1n },
  { kind: 'FIXED', value: 1000 },
  { kind: 'OTHER', value: 1n },
  { kind: 'toString', value: 1n },
  null,
])('rejects invalid calc %o in every component and step', (calc) => {
  for (const key of ['base', 'packageSale']) {
    expect(validateCommissionPlan({ ...version(), [key]: { enabled: true, calc } })).toEqual({
      ok: false,
      code: 'INVALID_CALC',
    });
  }
  expect(
    validateCommissionPlan({
      ...version(),
      tiers: { ...validTiers, steps: [{ from: { kind: 'AMOUNT', value: 0n }, calc }] },
    }),
  ).toEqual({ ok: false, code: 'INVALID_CALC' });
});

it('allows disabled omitted components and disabled empty tiers, validates retained configuration', () => {
  expect(
    validateCommissionPlan({
      base: { enabled: false },
      tiers: { enabled: false },
      packageSale: { enabled: false },
    }),
  ).toEqual({ ok: true });
  expect(
    validateCommissionPlan({ ...version(), tiers: { ...validTiers, enabled: false, steps: [] } }),
  ).toEqual({ ok: true });
  expect(
    validateCommissionPlan({ ...version(), base: { enabled: false, calc: pct(10001n) } }),
  ).toEqual({ ok: false, code: 'INVALID_CALC' });
});
