import { afterAll, beforeAll, expect, it } from 'vitest';

import { expectLockBeforeFirstWrite } from '../../../../../packages/db/test/statement-lock-order.ts';
import { createCommissionPlanVersionScope } from '../persistence/commission-plan-version-scope.ts';
import { writeCommissionPlanVersion } from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import {
  closeCommissionFixture,
  COMMISSION_NOW,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  ids,
  setCommissionStatement,
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

it('CM-08 waits on the approval lock, then sees APPROVED and writes no plan or audit', async () => {
  await setCommissionStatement(f, '2026-10', 'APPROVED');
  const before = await versionAndAuditCounts(f);
  const actor = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    employeeId: f.employee,
  };
  await expect(
    expectLockBeforeFirstWrite({
      db: f.db,
      ownerUrl: f.h.ownerUrl,
      companyId: f.company,
      businessId: f.business,
      period: '2026-10',
      ids,
      inputTables: ['commission_plan_versions'],
      writer: (tx) =>
        writeCommissionPlanVersion(
          createCommissionPlanVersionScope(tx, actor, ids, f.readers),
          {
            ...actor,
            input: { ...commissionPlanInput('2026-10-01'), whole_period: true },
            key: 'cm-08-lock',
            fingerprint: 'a'.repeat(64),
          },
          ids,
          { now: () => COMMISSION_NOW },
        ),
    }),
  ).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });
  const response = await f.post(
    { ...commissionPlanInput('2026-10-01'), whole_period: true },
    'cm-08-http',
  );
  expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_CLOSED']);
  expect(await versionAndAuditCounts(f)).toEqual(before);
});
