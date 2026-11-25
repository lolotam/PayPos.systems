import { buildCommissionStatementWorkbook } from '@pospay/documents';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import postgres from 'postgres';
import { afterAll, beforeAll } from 'vitest';

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
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { commissionStatementLabels } from '../../../documents/sources/commission-statement-labels.ts';
import { createCommissionStatementExportReader } from '../index.ts';

/** حالة ملف الاختبار الواحد: قاعدة معزولة وقارئ التصدير؛ كل ملف spec بيجهّز نسخته من useExportHarness. */
export const ctx = {} as {
  owner: postgres.Sql;
  db: Database;
  reader: ReturnType<typeof createCommissionStatementExportReader>;
};
export const ids = systemUuidV7();
export const { A, B } = COMMISSION_TENANT;
let testDb: TestDatabase;

/** بيجهّز قاعدة اختبار معزولة بمستأجرين الكشف ويقفلها بعد الملف؛ بيتنادى مرة في أول كل ملف spec. */
export function useExportHarness(): void {
  beforeAll(async () => {
    testDb = await createTestDatabase();
    await seedCommissionStatementTenants(testDb.ownerUrl);
    ctx.owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
    ctx.db = createDatabase({ url: testDb.appUrl, ids });
    ctx.reader = createCommissionStatementExportReader(ctx.db);
  });

  afterAll(async () => {
    await ctx.db?.close();
    await ctx.owner?.end();
    await testDb?.drop();
  });
}

export async function statement(
  tenant: CommissionTenant,
  period: string,
  rows: readonly FrozenLineOverrides[] = [],
): Promise<string> {
  return walkCommissionStatement(ctx.db, {
    tenant,
    period,
    ids,
    afterApproved: async (tx, statementId) => {
      for (const row of rows) await insertCommissionLine(tx, tenant, statementId, ids, row);
    },
  });
}

export async function exportRequest(
  tenant: CommissionTenant,
  statementId: string,
  period: string,
  overrides: StatementExportOverrides = {},
): Promise<string> {
  const renderId = ids.newId();
  await ctx.db.withTenant(tenant.company, (tx) =>
    insertStatementExport(tx, { tenant, statementId, period, ids }, { ...overrides, renderId }),
  );
  return renderId;
}

export async function addBranch(tenant: CommissionTenant): Promise<string> {
  const branchId = ids.newId();
  await ctx.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${tenant.company},${branchId},${tenant.business},'Hawally')`;
  return branchId;
}

let nextEmployeeNumber = 3;

export async function addEmployee(
  tenant: CommissionTenant,
  primaryBranchId: string,
  employeeNumber: number,
): Promise<string> {
  const employeeId = ids.newId();
  const name = `Other employee ${employeeNumber}`;
  await ctx.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${tenant.company},${employeeId},${tenant.business},${primaryBranchId},${name},
      ${employeeNameMatchKey(name)},'staff','2026-01-01',${employeeNumber})`;
  return employeeId;
}

export async function businessStatement(period: string): Promise<string> {
  return statement(A, period, [
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
}

export interface TransferredStatement {
  readonly statementId: string;
  readonly hawally: string;
  readonly otherEmployee: string;
  readonly otherNumber: number;
}

export async function transferredStatement(period: string): Promise<TransferredStatement> {
  const hawally = await addBranch(A);
  const otherNumber = nextEmployeeNumber;
  nextEmployeeNumber += 1;
  const otherEmployee = await addEmployee(A, A.branch, otherNumber);
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:sara', attachedBranchIds: [A.branch, hawally] },
    {
      sourceRef: 'line:early',
      kind: 'COMMISSION',
      amount: '10.000',
      sourceBranchId: hawally,
      sourceBranchNameAr: 'حولي وقت الاعتماد',
      sourceBranchNameEn: 'Hawally at approval',
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
      sourceBranchNameAr: 'السالمية وقت الاعتماد',
      sourceBranchNameEn: 'Salmiya at approval',
      attachedBranchIds: [A.branch],
    },
    {
      sourceRef: 'employee:other',
      employeeId: otherEmployee,
      employeeNumber: otherNumber,
      attachedBranchIds: [A.branch],
    },
  ]);
  return { statementId, hawally, otherEmployee, otherNumber };
}

export type PaidMethod = 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH';

export interface StoredPayment {
  readonly employeeId: string;
  readonly exact: string;
  readonly paid: string;
}

/** بيدفع كشف معتمد بالمسار اللي تريغرات 0253 بتقبله: الحالة وأعمدة الصرف وصف دفع لكل موظفة في معاملة واحدة. */
export async function payStatement(
  tenant: CommissionTenant,
  statementId: string,
  method: PaidMethod,
  payments: readonly StoredPayment[],
): Promise<void> {
  await ctx.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`UPDATE commission_statements SET status='PAID', paid_by=${USER},
      paid_at='2026-11-03T08:00:00Z', paid_on='2026-11-03', paid_method=${method}
      WHERE company_id=${tenant.company} AND id=${statementId}`);
    for (const payment of payments) {
      await tx.execute(sql`INSERT INTO commission_statement_payments(
        company_id,id,business_id,statement_id,employee_id,exact_payable,paid_amount)
        VALUES (${tenant.company},${ids.newId()},${tenant.business},${statementId},
          ${payment.employeeId},${payment.exact},${payment.paid})`);
    }
  });
}

export async function summarySheet(result: Awaited<ReturnType<typeof ctx.reader>>) {
  const bytes = await buildCommissionStatementWorkbook({
    language: result.request.language,
    scope: result.request.scope,
    labels: commissionStatementLabels(result.request.language),
    rows: result.rows,
    employees: result.employees,
    paidCash: result.paidCash,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new Error('the summary sheet is missing');
  return sheet;
}

export const PAID_CASH_HEADER = 'Paid cash';

export function headerCells(sheet: ExcelJS.Worksheet): string[] {
  return (sheet.getRow(1).values as unknown[]).map(String);
}

export function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}
