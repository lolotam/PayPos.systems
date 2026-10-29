import { afterAll, beforeAll, expect, it } from 'vitest';

import { expectLockBeforeFirstWrite } from '../../../../../../packages/db/test/statement-lock-order.ts';
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
  await setCommissionStatement(f, '2026-10', 'APPROVED');
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it.each([
  {
    label: 'whole-period',
    input: { ...commissionPlanInput('2026-10-01'), whole_period: true },
  },
  {
    label: 'ordinary',
    input: { ...commissionPlanInput('2026-10-31'), whole_period: false },
  },
])(
  'CM-08 waits on the approval lock, then sees APPROVED and writes no plan or audit ($label)',
  async ({ label, input }) => {
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
              input,
              key: `cm-08-lock-${label}`,
              fingerprint: 'a'.repeat(64),
            },
            ids,
            { now: () => COMMISSION_NOW },
          ),
      }),
    ).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });
    const response = await f.post(input, `cm-08-http-${label}`);
    expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_CLOSED']);
    expect(await versionAndAuditCounts(f)).toEqual(before);
  },
);

it('the commissions feature turned off after the guard refuses the write with FEATURE_DISABLED and stores nothing', async () => {
  const before = await versionAndAuditCounts(f);
  const actor = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    employeeId: f.employee,
  };
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'commissions',false,'Synthetic disabled',${f.userId})`;
  try {
    await expect(
      f.db.withTenant(
        f.company,
        (tx) =>
          writeCommissionPlanVersion(
            createCommissionPlanVersionScope(tx, actor, ids, f.readers),
            {
              ...actor,
              input: commissionPlanInput('2026-11-15'),
              key: 'commissions-feature-disabled',
              fingerprint: 'b'.repeat(64),
            },
            ids,
            { now: () => COMMISSION_NOW },
          ),
        { userId: f.userId },
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(await versionAndAuditCounts(f)).toEqual(before);
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
  }
});
