import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { CommissionStatementExportRequestMissing } from '../index.ts';
import {
  commissionStatementExportRequestStatement,
  commissionStatementFrozenRowsStatement,
} from '../queries/commission-statement-export.query.ts';
import {
  A,
  B,
  businessStatement,
  ctx,
  exportRequest,
  ids,
  planNodes,
  statement,
  transferredStatement,
  useExportHarness,
} from './commission-statement-export-harness.ts';

useExportHarness();

it('BUSINESS returns every frozen row and its exact result shape', async () => {
  const period = '2026-10';
  const statementId = await businessStatement(period);
  const renderId = await exportRequest(A, statementId, period, { language: 'en' });
  const result = await ctx.reader(A.company, renderId);
  expect(result.request).toEqual({
    statementId,
    businessId: A.business,
    period,
    statementStatus: 'APPROVED',
    paidMethod: null,
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
  expect(result.rows.every((row) => row.partial === false)).toBe(true);
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
  expect(result.employees).toHaveLength(1);
  expect(result.employees[0]).toMatchObject({
    employeeId: A.employee,
    employeeNumber: 1,
    commission: 41_003n,
    salesCommission: 0n,
    corrections: -3_000n,
    cardTips: 0n,
    cashTips: 0n,
    netPayable: 38_003n,
    partial: false,
  });
});

it('BRANCHES applies both saved sets to every row, including the transferred employee', async () => {
  const period = '2026-11';
  const { statementId, hawally, otherEmployee } = await transferredStatement(period);
  const renderId = await exportRequest(A, statementId, period, {
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [A.employee, otherEmployee],
  });
  const result = await ctx.reader(A.company, renderId);
  expect(result.rows.map((row) => row.sourceRef).sort()).toEqual([
    'correction:early',
    'employee:other',
    'employee:sara',
    'line:early',
  ]);
  expect(result.rows.every((row) => row.attachedBranchIds.includes(A.branch))).toBe(true);
  const early = result.rows.find((row) => row.sourceRef === 'line:early');
  expect(early?.sourceBranchId).toBe(hawally);
  expect(early?.sourceBranchNameEn).toBe('Hawally at approval');
  expect(early?.sourceBranchNameEn).not.toBe('Hawally');
  expect(early?.sourceBranchNameAr).toBe('حولي وقت الاعتماد');
  expect(early?.amount).toBe(10_000n);
  expect(early?.partial).toBe(true);
  const correction = result.rows.find((row) => row.sourceRef === 'correction:early');
  expect(correction?.sourceBranchNameEn).toBe('Salmiya at approval');
  expect(correction?.sourceBranchNameAr).toBe('السالمية وقت الاعتماد');
  expect(correction?.amount).toBe(5_000n);
  // صف الموظفة مالوش فرع تنفيذ، فالخانة فاضية.
  expect(
    result.rows.find((row) => row.sourceRef === 'employee:other')?.sourceBranchNameEn,
  ).toBeNull();
  expect(result.rows.find((row) => row.sourceRef === 'employee:other')?.partial).toBe(false);
  expect(result.rows.some((row) => row.customerName === 'Late customer')).toBe(false);
});

it('BRANCHES excludes an empty-branch carry and still marks the employee partial', async () => {
  const period = '2027-03';
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:sara', attachedBranchIds: [A.branch] },
    {
      sourceRef: 'carry:sara',
      kind: 'CARRY_COMMISSION',
      amount: '-3.000',
      attachedBranchIds: [],
    },
  ]);
  const renderId = await exportRequest(A, statementId, period, {
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [A.employee],
  });
  const result = await ctx.reader(A.company, renderId);
  expect(result.rows.map((row) => row.sourceRef)).toEqual(['employee:sara']);
  expect(result.rows[0]?.partial).toBe(true);
});

it('a missing render id and another tenant render id both find no request', async () => {
  const period = '2026-12';
  const statementId = await statement(A, period);
  const renderId = await exportRequest(A, statementId, period);
  await expect(ctx.reader(A.company, ids.newId())).rejects.toThrow(
    CommissionStatementExportRequestMissing,
  );
  await expect(ctx.reader(B.company, renderId)).rejects.toThrow(
    CommissionStatementExportRequestMissing,
  );
});

it('the request and frozen-row reads use their indexes and keep their result shape', async () => {
  const period = '2027-01';
  const statementId = await statement(A, period, [
    { sourceRef: 'employee:index', attachedBranchIds: [A.branch] },
  ]);
  const renderId = await exportRequest(A, statementId, period);
  const plans = await ctx.db.withTenant(A.company, async (tx) => {
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
    const branchRowsPlan = await tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionStatementFrozenRowsStatement({
        companyId: A.company,
        businessId: A.business,
        statementId,
        scope: 'BRANCHES',
        branchIds: [A.branch],
        employeeIds: [A.employee],
      })}`,
    );
    return { requestPlan, rowsPlan, branchRowsPlan };
  });
  const requestNodes = planNodes(plans.requestPlan);
  expect(
    requestNodes.some(
      (node) =>
        node['Relation Name'] === 'commission_statement_exports' &&
        node['Node Type'] === 'Seq Scan',
    ),
  ).toBe(false);
  expect(
    requestNodes.some(
      (node) =>
        node['Relation Name'] === 'commission_statement_exports' &&
        ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan', 'Bitmap Heap Scan'].includes(
          String(node['Node Type']),
        ),
    ),
  ).toBe(true);
  expectLinesIndexScan(plans.rowsPlan);
  expectLinesIndexScan(plans.branchRowsPlan);
});

function expectLinesIndexScan(plan: unknown): void {
  const nodes = planNodes(plan);
  expect(
    nodes.some(
      (node) =>
        node['Relation Name'] === 'commission_statement_lines' && node['Node Type'] === 'Seq Scan',
    ),
  ).toBe(false);
  expect(
    nodes.some((node) =>
      String(node['Index Name'] ?? '').startsWith('commission_statement_lines_'),
    ),
  ).toBe(true);
}
