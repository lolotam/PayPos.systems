import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '@pospay/db';
import {
  COMMISSION_TENANT,
  insertCommissionLine,
  insertStatementExport,
  seedCommissionStatementTenants,
  walkCommissionStatement,
  type CommissionTenant,
  type FrozenLineOverrides,
  type StatementExportOverrides,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import {
  CommissionStatementExportRequestMissing,
  CommissionStatementPaymentDataUnavailable,
  createCommissionStatementExportReader,
} from '../index.ts';
import {
  commissionStatementExportRequestStatement,
  commissionStatementFrozenRowsStatement,
} from '../queries/commission-statement-export.query.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let reader: ReturnType<typeof createCommissionStatementExportReader>;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  reader = createCommissionStatementExportReader(db);
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

async function statement(
  tenant: CommissionTenant,
  period: string,
  rows: readonly FrozenLineOverrides[] = [],
): Promise<string> {
  return walkCommissionStatement(db, {
    tenant,
    period,
    ids,
    afterApproved: async (tx, statementId) => {
      for (const row of rows) await insertCommissionLine(tx, tenant, statementId, ids, row);
    },
  });
}

async function exportRequest(
  tenant: CommissionTenant,
  statementId: string,
  period: string,
  overrides: StatementExportOverrides = {},
): Promise<string> {
  const renderId = ids.newId();
  await db.withTenant(tenant.company, (tx) =>
    insertStatementExport(tx, { tenant, statementId, period, ids }, { ...overrides, renderId }),
  );
  return renderId;
}

async function addBranch(tenant: CommissionTenant): Promise<string> {
  const branchId = ids.newId();
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${tenant.company},${branchId},${tenant.business},'Hawally')`;
  return branchId;
}

async function addEmployee(tenant: CommissionTenant, primaryBranchId: string): Promise<string> {
  const employeeId = ids.newId();
  const name = 'Other employee';
  await owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${tenant.company},${employeeId},${tenant.business},${primaryBranchId},${name},
      ${employeeNameMatchKey(name)},'staff','2026-01-01',3)`;
  return employeeId;
}

it('BUSINESS returns every frozen row and its exact result shape', async () => {
  const period = '2026-10';
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:a', attachedBranchIds: [A.branch] },
    {
      sourceRef: 'line:business',
      kind: 'COMMISSION',
      amount: '41.003',
      attachedBranchIds: [A.branch],
      serviceNameAr: 'قص شعر',
      serviceNameEn: 'Haircut',
      customerName: 'نورة محمد',
    },
    {
      sourceRef: 'carry:business',
      kind: 'CARRY_COMMISSION',
      amount: '-3.000',
      attachedBranchIds: [],
    },
  ]);
  const renderId = await exportRequest(A, statementId, period, { language: 'en' });
  const result = await reader(A.company, renderId);
  expect(result.request).toEqual({
    statementId,
    businessId: A.business,
    period,
    statementStatus: 'APPROVED',
    language: 'en',
    scope: 'BUSINESS',
    branchIds: null,
    employeeIds: null,
  });
  expect(result.rows.map((row) => row.sourceRef).sort()).toEqual([
    'carry:business',
    'employee:a',
    'line:business',
  ]);
  const line = result.rows.find((row) => row.sourceRef === 'line:business');
  expect(line).toMatchObject({
    employeeId: A.employee,
    employeeNumber: 1,
    employeeNameEn: 'Frozen employee',
    kind: 'COMMISSION',
    amount: 41_003n,
    attachedBranchIds: [A.branch],
    businessDate: '2026-10-15',
    serviceNameAr: 'قص شعر',
    serviceNameEn: 'Haircut',
    customerName: 'نورة محمد',
  });
  expect(result.paidCash).toBeNull();
});

it('BRANCHES applies both saved sets to every row, including the transferred employee', async () => {
  const period = '2026-11';
  const hawally = await addBranch(A);
  const otherEmployee = await addEmployee(A, A.branch);
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:sara', attachedBranchIds: [A.branch, hawally] },
    {
      sourceRef: 'line:early',
      kind: 'COMMISSION',
      amount: '10.000',
      sourceBranchId: hawally,
      sourceBusinessDate: '2026-10-10',
      attachedBranchIds: [A.branch],
      customerName: 'Early customer',
    },
    {
      sourceRef: 'line:late',
      kind: 'COMMISSION',
      amount: '20.000',
      sourceBranchId: hawally,
      sourceBusinessDate: '2026-10-20',
      attachedBranchIds: [hawally],
      customerName: 'Late customer',
    },
    {
      sourceRef: 'correction:early',
      kind: 'CORRECTION',
      amount: '5.000',
      previousAmount: '10.000',
      newAmount: '15.000',
      attachedBranchIds: [A.branch],
    },
    {
      sourceRef: 'employee:other',
      employeeId: otherEmployee,
      employeeNumber: 3,
      attachedBranchIds: [A.branch],
    },
  ]);
  const renderId = await exportRequest(A, statementId, period, {
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [A.employee],
  });
  const result = await reader(A.company, renderId);
  expect(result.rows.map((row) => row.sourceRef).sort()).toEqual([
    'correction:early',
    'employee:sara',
    'line:early',
  ]);
  expect(result.rows.every((row) => row.employeeId === A.employee)).toBe(true);
  expect(result.rows.every((row) => row.attachedBranchIds.includes(A.branch))).toBe(true);
  const early = result.rows.find((row) => row.sourceRef === 'line:early');
  expect(early?.sourceBranchId).toBe(hawally);
  expect(early?.amount).toBe(10_000n);
  expect(JSON.stringify(result.rows)).not.toContain('Late customer');
  expect(JSON.stringify(result.rows)).not.toContain(otherEmployee);
});

it('a missing render id and another tenant render id both find no request', async () => {
  const period = '2026-12';
  const statementId = await statement(A, period);
  const renderId = await exportRequest(A, statementId, period);
  await expect(reader(A.company, ids.newId())).rejects.toThrow(
    CommissionStatementExportRequestMissing,
  );
  await expect(reader(B.company, renderId)).rejects.toThrow(
    CommissionStatementExportRequestMissing,
  );
});

it('a paid request fails explicitly while the 54-1 payment record is unavailable', async () => {
  const period = '2027-02';
  const statementId = await walkCommissionStatement(db, { tenant: A, period, ids, to: 'PAID' });
  const renderId = await exportRequest(A, statementId, period);
  await expect(reader(A.company, renderId)).rejects.toThrow(
    CommissionStatementPaymentDataUnavailable,
  );
});

it('the request and frozen-row reads use their indexes and keep their result shape', async () => {
  const period = '2027-01';
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:index', attachedBranchIds: [A.branch] },
  ]);
  const renderId = await exportRequest(A, statementId, period);
  const plans = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const requestPlan = await tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionStatementExportRequestStatement(
        A.company,
        renderId,
      )}`,
    );
    const rowsPlan = await tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionStatementFrozenRowsStatement({
        companyId: A.company,
        businessId: A.business,
        statementId,
        scope: 'BUSINESS',
        branchIds: null,
        employeeIds: null,
      })}`,
    );
    return { requestPlan, rowsPlan };
  });
  const requestNodes = planNodes(plans.requestPlan);
  expect(
    requestNodes.some((node) => node['Index Name'] === 'commission_statement_exports_render_key'),
  ).toBe(true);
  const rowNodes = planNodes(plans.rowsPlan);
  expect(
    rowNodes.some(
      (node) =>
        node['Relation Name'] === 'commission_statement_lines' && node['Node Type'] === 'Seq Scan',
    ),
  ).toBe(false);
  expect(
    rowNodes.some((node) =>
      String(node['Index Name'] ?? '').startsWith('commission_statement_lines_'),
    ),
  ).toBe(true);
});

function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}
