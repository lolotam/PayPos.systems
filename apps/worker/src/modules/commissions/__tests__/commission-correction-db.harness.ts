import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  insertCommissionLineProjection,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { lockTargetStatement } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { CommissionCorrectionDraft } from '../domain/commission-correction-step.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import type { CommissionCorrectionScope } from '../ports/commission-correction.port.ts';

export const ids = systemUuidV7();
export const { A } = COMMISSION_LINE_TENANTS;
export const clock = { now: () => new Date('2026-11-01T09:00:00Z') };
export const SOURCE_PERIOD = '2026-10';
export const TARGET_PERIOD = '2026-11';
export const EVENT_ID = '01970000-0000-7000-8000-000000000e01';
export const TIP_SESSION = '01970000-0000-7000-8000-000000000f01';
export const SOURCE_REF = `line:${COMMISSION_LINE_IDS.lineA}`;
export { COMMISSION_LINE_IDS };

let testDb: TestDatabase;
export let owner: postgres.Sql;
export let db: Database;
export let sourceStatementId: string;
export let targetStatementId: string;

export const inScope = async <T>(
  work: (scope: CommissionCorrectionScope) => Promise<T>,
): Promise<T> =>
  db.withTenant(A.company, async (tx) => work(createCommissionCorrectionScope(tx, ids, clock)));

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  sourceStatementId = await walkCommissionStatement(db, {
    tenant: A,
    period: SOURCE_PERIOD,
    ids,
    to: 'APPROVED',
    afterApproved: async (tx, statementId) => {
      await insertCommissionLine(tx, A, statementId, ids, {
        kind: 'COMMISSION',
        lineId: COMMISSION_LINE_IDS.lineA,
        sourceRef: SOURCE_REF,
        amount: '20.000',
        sourceBranchId: A.branch,
        sourceBusinessDate: '2026-10-15',
        attachedBranchIds: [A.branch],
      });
      await insertCommissionAttachment(tx, A, statementId, ids, {});
    },
  });
  targetStatementId = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: TARGET_PERIOD,
    ids,
  });
  await seedProjection();
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
});

async function seedProjection(): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionLineProjection(tx, A, ids, {
      lineId: COMMISSION_LINE_IDS.lineA,
      businessDate: '2026-10-05',
      occurredAt: '2026-10-05T09:00:00Z',
      recordedAt: '2026-10-05T09:00:00Z',
      period: SOURCE_PERIOD,
      net: '10.000',
      ruleKind: 'PCT',
      rulePctBps: 1500,
    });
    await insertCommissionPlanVersion(tx, A, ids, {
      effectiveFrom: '2026-10-01',
      plan: {
        base: { enabled: true, calc: { kind: 'PCT', bps: 1000 } },
        tiers: { enabled: false },
        package_sale: { enabled: false },
      },
    });
  });
  await owner`INSERT INTO commission_tip_heads(
    company_id,id,business_id,session_id,branch_id,revision,business_date,period)
    VALUES(${A.company},${ids.newId()},${A.business},${TIP_SESSION},${A.branch},1,
      '2026-10-05'::date,${SOURCE_PERIOD})`;
  await owner`INSERT INTO commission_tips(company_id,id,business_id,session_id,employee_id,method,amount)
    VALUES(${A.company},${ids.newId()},${A.business},${TIP_SESSION},${A.employee},'CARD','7.500')`;
  await owner`INSERT INTO commission_salaries(
    company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${A.company},${ids.newId()},${A.business},${A.employee},'2026-10-01'::date,'500.000',1)`;
  await owner`INSERT INTO commission_service_overrides(
    company_id,id,business_id,employee_id,service_id,rule_kind,rule_pct_bps,rule_fixed_amount,
    effective_from,created_at,created_by)
    VALUES(${A.company},${ids.newId()},${A.business},${A.employee},${A.service},'PCT',1500,NULL,
      '2026-10-01'::date,'2026-10-01T08:00:00Z'::timestamptz,${USER})`;
}

export const draft = (): CommissionCorrectionDraft => ({
  employeeId: A.employee,
  sourcePeriod: SOURCE_PERIOD,
  targetPeriod: TARGET_PERIOD,
  targetStatementId,
  sourceRef: SOURCE_REF,
  kind: 'COMMISSION',
  previousAmount: 20_000n,
  newAmount: 25_000n,
  amount: 5_000n,
  generation: 1,
  eventId: EVENT_ID,
  attribution: {
    sourceBranchId: A.branch,
    sourceBusinessDate: '2026-10-15',
    attachedBranchIds: [A.branch],
  },
});
