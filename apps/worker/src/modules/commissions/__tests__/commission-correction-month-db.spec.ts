import { expect, it } from 'vitest';

import {
  A,
  COMMISSION_LINE_IDS,
  draft,
  inScope,
  SOURCE_PERIOD,
  SOURCE_REF,
  TARGET_PERIOD,
  TIP_SESSION,
} from './commission-correction-db.harness.ts';

it('reads the month projection of the employee in the engine input shapes', async () => {
  const projection = await inScope((scope) =>
    scope.readMonthProjection({
      businessId: A.business,
      employeeId: A.employee,
      period: SOURCE_PERIOD,
    }),
  );
  expect(projection.employeeId).toBe(A.employee);
  expect(projection.period).toBe(SOURCE_PERIOD);
  expect(projection.sales).toEqual([]);
  expect(projection.lines).toHaveLength(1);
  expect(projection.lines[0]).toMatchObject({
    lineId: COMMISSION_LINE_IDS.lineA,
    employeeId: A.employee,
    serviceId: A.service,
    branchId: A.branch,
    businessDate: '2026-10-05',
    netShare: 10_000n,
    shareBps: 10_000n,
    counts: true,
    ruleSnapshot: { kind: 'PCT', value: 1500n },
    status: 'ACTIVE',
  });
  expect(typeof projection.lines[0]?.occurredAt).toBe('bigint');
  expect(projection.tips).toEqual([
    {
      sessionId: TIP_SESSION,
      employeeId: A.employee,
      branchId: A.branch,
      businessDate: '2026-10-05',
      method: 'CARD',
      amount: 7_500n,
    },
  ]);
  expect(projection.salaries).toEqual([
    { employeeId: A.employee, effectiveFrom: '2026-10-01', amount: 500_000n },
  ]);
  expect(projection.versions).toHaveLength(1);
  expect(projection.versions[0]).toMatchObject({
    employeeId: A.employee,
    effectiveFrom: '2026-10-01',
    version: 1n,
    base: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
    tiers: { enabled: false },
    packageSale: { enabled: false },
  });
  expect(projection.overrides).toHaveLength(1);
  expect(projection.overrides[0]).toMatchObject({
    employeeId: A.employee,
    serviceId: A.service,
    effectiveFrom: '2026-10-01',
    rule: { kind: 'PCT', value: 1500n },
  });
  expect(projection.corrections).toEqual([]);
});

it('shows the received correction in the target month projection', async () => {
  await inScope((scope) => scope.insertCorrections({ businessId: A.business, drafts: [draft()] }));
  const projection = await inScope((scope) =>
    scope.readMonthProjection({
      businessId: A.business,
      employeeId: A.employee,
      period: TARGET_PERIOD,
    }),
  );
  expect(projection.corrections).toEqual([
    {
      employeeId: A.employee,
      sourcePeriod: SOURCE_PERIOD,
      targetPeriod: TARGET_PERIOD,
      sourceRef: SOURCE_REF,
      kind: 'COMMISSION',
      amount: 5_000n,
      previousAmount: 20_000n,
      newAmount: 25_000n,
      generation: 1n,
    },
  ]);
});
