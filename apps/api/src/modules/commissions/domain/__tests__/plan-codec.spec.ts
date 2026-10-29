import { expect, it } from 'vitest';

import { toEngineCommissionPlan } from '../plan-codec.ts';

it('converts every wire value to the engine representation without numeric money', () => {
  expect(
    toEngineCommissionPlan({
      base: { enabled: true, calc: { kind: 'FIXED', amount: '1.250' } },
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          {
            from: { kind: 'SALARY_MULTIPLE', value: '2.05' },
            calc: { kind: 'PCT', bps: 500 },
          },
          {
            from: { kind: 'AMOUNT', value: '3000.000' },
            calc: { kind: 'FIXED', amount: '2.000' },
          },
        ],
      },
      package_sale: { enabled: false },
    }),
  ).toEqual({
    base: { enabled: true, calc: { kind: 'FIXED', value: 1250n } },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        { from: { kind: 'SALARY_MULTIPLE', value: 205n }, calc: { kind: 'PCT', value: 500n } },
        { from: { kind: 'AMOUNT', value: 3000000n }, calc: { kind: 'FIXED', value: 2000n } },
      ],
    },
    packageSale: { enabled: false, calc: undefined },
  });
});

it('converts sessions and preserves disabled component settings for the validator', () => {
  expect(
    toEngineCommissionPlan({
      base: { enabled: false, calc: { kind: 'PCT', bps: 10001 } },
      tiers: {
        enabled: false,
        mode: 'WHOLE',
        accumulator: 'SESSIONS',
        steps: [
          { from: { kind: 'SESSIONS', value: 4 }, calc: { kind: 'PCT', bps: 100 } },
        ],
      },
      package_sale: { enabled: false },
    }),
  ).toMatchObject({
    base: { enabled: false, calc: { kind: 'PCT', value: 10001n } },
    tiers: {
      steps: [{ from: { kind: 'SESSIONS', value: 4n }, calc: { kind: 'PCT', value: 100n } }],
    },
  });
});
