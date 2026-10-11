import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceReportBranchInputs } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { attendanceReportContractsStatement } from '../queries/attendance-report-contracts.query.ts';
import { employeeContractedMinutes } from '../queries/employee-contracted-minutes.query.ts';
import { monthlyReportFixture, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
const statement = () => attendanceReportContractsStatement(f.company,f.business,
  sql`ARRAY[${f.branch}::uuid,${f.secondBranch}::uuid]`,
  sql`(${f.branch}::uuid,'Asia/Kuwait'::text),(${f.secondBranch}::uuid,'Asia/Kuwait'::text)`,
  '2026-10-01','2026-10-31');

it('set-based result shape equals the existing 16d inputs for both branches, including employment and link boundaries', async () => {
  for (const boundary of ['unchanged','limited contract','ended link','deleted employee']) {
    if (boundary === 'limited contract') await f.h.owner`UPDATE employees SET hire_date='2026-10-10',contract_end='2026-10-20'
      WHERE company_id=${f.company} AND id=${f.employee.id}`;
    if (boundary === 'ended link') await f.h.owner`UPDATE employee_branches SET "to"='2026-10-10'
      WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
    if (boundary === 'deleted employee') await f.h.owner`UPDATE employees SET deleted_at='2026-09-20T10:00:00Z'
      WHERE company_id=${f.company} AND id=${f.employee.id}`;
    await f.db.withTenant(f.company,async (tx) => {
      const actual = await tx.execute(statement());
      const expected = [];
      for (const branch of [f.branch,f.secondBranch]) {
        const rows = await employeeContractedMinutes(tx,f.company,f.business,branch,'2026-10-01','2026-10-31');
        expected.push(...rows.map((row) => ({...row,branch_id:branch,
          entries:row.entries.map(({day,start,end}) => ({day,start,end}))})));
      }
      const ordered = (rows: Record<string,unknown>[]) => rows.toSorted((a,b) => String(a['branch_id']).localeCompare(String(b['branch_id'])));
      expect(ordered(actual),boundary).toEqual(ordered(expected));
      for (const row of actual) {
        expect(Object.keys(row).sort()).toEqual(['branch_id','contract_end','employee_id','entries','hire_date','links']);
        expect(attendanceReportBranchInputs.shape.contract.safeParse(row).success).toBe(true);
      }
    });
  }
});

it('EXPLAIN ANALYZE uses the existing default/link tenant indexes and foreign tenants see no rows', async () => {
  const plans = await f.db.withTenant(f.company,async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement()}`);
  });
  expect(JSON.stringify(plans)).toMatch(/employee_default_shifts_(pkey|company_business_branch_idx)/);
  expect(JSON.stringify(plans)).toMatch(/employee_branches_/);
  expect(await f.db.withTenant(f.otherCompany,(tx) => tx.execute(statement()))).toEqual([]);
});
