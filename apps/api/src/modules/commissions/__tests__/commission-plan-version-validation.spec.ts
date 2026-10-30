import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  versionAndAuditCounts,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

let f: CommissionPlanFixture;
beforeAll(async () => {
  f = await commissionPlanVersionsFixture();
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

const cases: readonly [string, string, () => CreateCommissionPlanVersionInput][] = [
  [
    'INVALID_COMBINATION',
    'cm-06-combination',
    () => ({
      ...commissionPlanInput(),
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [{ from: { kind: 'SESSIONS', value: 1 }, calc: { kind: 'PCT', bps: 500 } }],
      },
    }),
  ],
  [
    'MIXED_THRESHOLDS',
    'cm-06-mixed',
    () => ({
      ...commissionPlanInput(),
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          { from: { kind: 'AMOUNT', value: '1.000' }, calc: { kind: 'PCT', bps: 100 } },
          { from: { kind: 'SESSIONS', value: 2 }, calc: { kind: 'PCT', bps: 200 } },
        ],
      },
    }),
  ],
  [
    'STEPS_NOT_ASCENDING',
    'cm-06-order',
    () => ({
      ...commissionPlanInput(),
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          { from: { kind: 'AMOUNT', value: '2.000' }, calc: { kind: 'PCT', bps: 100 } },
          { from: { kind: 'AMOUNT', value: '1.000' }, calc: { kind: 'PCT', bps: 200 } },
        ],
      },
    }),
  ],
  [
    'NO_STEPS',
    'cm-06-no-steps',
    () => ({
      ...commissionPlanInput(),
      tiers: { enabled: true, mode: 'MARGINAL', accumulator: 'AMOUNT', steps: [] },
    }),
  ],
  [
    'INVALID_CALC',
    'cm-06-calc',
    () => ({
      ...commissionPlanInput(),
      base: { enabled: true, calc: { kind: 'PCT', bps: 10001 } },
    }),
  ],
  [
    'INVALID_THRESHOLD',
    'cm-06-threshold',
    () => ({
      ...commissionPlanInput(),
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          {
            from: { kind: 'SALARY_MULTIPLE', value: '0.00' },
            calc: { kind: 'PCT', bps: 500 },
          },
        ],
      },
    }),
  ],
  [
    'INVALID_PLAN',
    'cm-06-plan',
    () => ({
      ...commissionPlanInput(),
      tiers: { enabled: false, mode: 'MARGINAL', accumulator: 'AMOUNT' },
    }),
  ],
];

it.each(cases)(
  'CM-06 %s is the engine refusal as 422 details.code, with no writes',
  async (code, key, input) => {
    const before = await versionAndAuditCounts(f);
    const response = await f.post(input(), key);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'COMMISSION_PLAN_INVALID', details: { code } });
    expect(await versionAndAuditCounts(f)).toEqual(before);
  },
);
