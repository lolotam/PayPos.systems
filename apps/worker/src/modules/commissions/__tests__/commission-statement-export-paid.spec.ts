import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { commissionStatementPaymentsStatement } from '../queries/commission-statement-export.query.ts';
import {
  A,
  businessStatement,
  ctx,
  exportRequest,
  headerCells,
  PAID_CASH_HEADER,
  payStatement,
  planNodes,
  summarySheet,
  transferredStatement,
  useExportHarness,
} from './commission-statement-export-harness.ts';

useExportHarness();

it.each([['WITH_SALARY'], ['BANK_TRANSFER']] as const)(
  'a %s paid statement exports with no paid-cash column',
  async (method) => {
    const period = method === 'WITH_SALARY' ? '2027-04' : '2027-05';
    const statementId = await businessStatement(period);
    await payStatement(A, statementId, method, [
      { employeeId: A.employee, exact: '38.003', paid: '38.003' },
    ]);
    const renderId = await exportRequest(A, statementId, period, { language: 'en' });
    const result = await ctx.reader(A.company, renderId);
    expect(result.request.statementStatus).toBe('PAID');
    expect(result.request.paidMethod).toBe(method);
    expect(result.paidCash).toBeNull();
    expect(headerCells(await summarySheet(result))).not.toContain(PAID_CASH_HEADER);
  },
);

it('a CASH paid statement exports the stored rounded amount while the net stays exact', async () => {
  const period = '2027-06';
  const statementId = await businessStatement(period);
  await payStatement(A, statementId, 'CASH', [
    { employeeId: A.employee, exact: '38.003', paid: '38.005' },
  ]);
  const renderId = await exportRequest(A, statementId, period, { language: 'en' });
  const result = await ctx.reader(A.company, renderId);
  expect(result.request.paidMethod).toBe('CASH');
  expect(result.paidCash).toEqual([{ employeeId: A.employee, amount: 38_005n }]);
  expect(result.employees[0]?.netPayable).toBe(38_003n);
  const sheet = await summarySheet(result);
  const column = headerCells(sheet).indexOf(PAID_CASH_HEADER);
  expect(column).toBeGreaterThan(0);
  expect(sheet.getRow(2).getCell(column).value).toBe('38.005');
});

it('a request made while APPROVED reads PAID and its cash amount once the statement is paid', async () => {
  const period = '2027-07';
  const statementId = await businessStatement(period);
  const renderId = await exportRequest(A, statementId, period);
  const approved = await ctx.reader(A.company, renderId);
  expect(approved.request.statementStatus).toBe('APPROVED');
  expect(approved.paidCash).toBeNull();
  await payStatement(A, statementId, 'CASH', [
    { employeeId: A.employee, exact: '41.003', paid: '41.005' },
  ]);
  const paid = await ctx.reader(A.company, renderId);
  expect(paid.request.statementStatus).toBe('PAID');
  expect(paid.paidCash).toEqual([{ employeeId: A.employee, amount: 41_005n }]);
});

it('BRANCHES CASH export withholds the paid amount of a partial employee only', async () => {
  const period = '2027-08';
  const { statementId, otherEmployee, otherNumber } = await transferredStatement(period);
  await payStatement(A, statementId, 'CASH', [
    { employeeId: A.employee, exact: '30.003', paid: '30.005' },
    { employeeId: otherEmployee, exact: '41.003', paid: '41.005' },
  ]);
  const renderId = await exportRequest(A, statementId, period, {
    language: 'en',
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [A.employee, otherEmployee],
  });
  const result = await ctx.reader(A.company, renderId);
  const sara = result.employees.find((employee) => employee.employeeId === A.employee);
  expect(sara?.partial).toBe(true);
  expect(result.paidCash).toEqual([{ employeeId: otherEmployee, amount: 41_005n }]);
  const sheet = await summarySheet(result);
  const column = headerCells(sheet).indexOf(PAID_CASH_HEADER);
  expect(column).toBeGreaterThan(0);
  const byNumber = new Map<number, unknown>();
  sheet.eachRow((row, index) => {
    if (index > 1) byNumber.set(Number(row.getCell(1).value), row.getCell(column).value);
  });
  expect(byNumber.get(1)).toBe('');
  expect(byNumber.get(otherNumber)).toBe('41.005');
});

it('BRANCHES CASH export with only partial employees keeps an empty paid-cash list', async () => {
  const period = '2027-09';
  const { statementId, otherEmployee } = await transferredStatement(period);
  await payStatement(A, statementId, 'CASH', [
    { employeeId: A.employee, exact: '30.003', paid: '30.005' },
    { employeeId: otherEmployee, exact: '41.003', paid: '41.005' },
  ]);
  const renderId = await exportRequest(A, statementId, period, {
    language: 'en',
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [A.employee],
  });
  const result = await ctx.reader(A.company, renderId);
  expect(result.employees.length).toBeGreaterThan(0);
  expect(result.employees.every((employee) => employee.partial)).toBe(true);
  expect(result.paidCash).toEqual([]);
  expect(headerCells(await summarySheet(result))).toContain(PAID_CASH_HEADER);
});

it('the payments read uses an index on the payments table and never scans it sequentially', async () => {
  const period = '2027-11';
  const statementId = await businessStatement(period);
  await payStatement(A, statementId, 'CASH', [
    { employeeId: A.employee, exact: '38.003', paid: '38.005' },
  ]);
  await ctx.owner`ANALYZE commission_statement_payments`;
  const plan = await ctx.db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionStatementPaymentsStatement({
        companyId: A.company,
        businessId: A.business,
        statementId,
      })}`,
    );
  });
  const nodes = planNodes(plan);
  expect(
    nodes.some(
      (node) =>
        node['Relation Name'] === 'commission_statement_payments' &&
        node['Node Type'] === 'Seq Scan',
    ),
  ).toBe(false);
  expect(nodes.map((node) => node['Index Name']).filter(Boolean)).toContain(
    'commission_statement_payments_statement_idx',
  );
});
