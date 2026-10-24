import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { attendanceMonthlyInputsStatement } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { monthlyReportFixture, reportHeaders, reportSession, reportUrl,
  type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
beforeEach(async () => {
  await f.h.owner`DELETE FROM attendance_sessions WHERE company_id=${f.company}`;
  await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  await f.h.owner`UPDATE employees SET hire_date='2026-01-01',contract_end=NULL,deleted_at='2026-11-05T10:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
});
async function report(branch = f.branch) {
  const response = await f.h.app.inject({method:'GET',url:reportUrl(f,branch),headers:reportHeaders(f)});
  expect(response.statusCode).toBe(200);
  return attendanceMonthlyReport.parse(response.json()).rows;
}

it.each([false,true])('November 5 deletion preserves October contracts and difference (worked session: %s)', async (worked) => {
  if (worked) await reportSession(f);
  const workedMinutes = worked ? 480 : 0;
  expect(await report()).toMatchObject([{employee_id:f.employee.id,worked_minutes:workedMinutes,
    contracted_minutes:13680,difference_minutes:workedMinutes-13680}]);
  expect(await report(f.secondBranch)).toMatchObject([{employee_id:f.employee.id,
    contracted_minutes:2400,difference_minutes:-2400}]);
  expect(await report('all')).toMatchObject([{employee_id:f.employee.id,worked_minutes:workedMinutes,
    contracted_minutes:16080,difference_minutes:workedMinutes-16080}]);
});

it.each([false,true])('October 1 01:00 Kuwait deletion counts only October 1 (all branches: %s)', async (all) => {
  await f.h.owner`UPDATE employees SET deleted_at='2026-09-30T22:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const contracted = 720;
  expect(await report(all ? 'all' : f.branch)).toMatchObject([{employee_id:f.employee.id,
    worked_minutes:0,contracted_minutes:contracted,difference_minutes:-contracted}]);
});

it.each([false,true])('October 15 Kuwait deletion includes that day and caps the difference (worked: %s)', async (worked) => {
  await f.h.owner`UPDATE employees SET deleted_at='2026-10-14T22:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  if (worked) await reportSession(f,{date:'2026-10-15'});
  const workedMinutes = worked ? 480 : 0;
  expect(await report()).toMatchObject([{employee_id:f.employee.id,worked_minutes:workedMinutes,
    contracted_minutes:6960,difference_minutes:workedMinutes-6960}]);
  expect(await report(f.secondBranch)).toMatchObject([{employee_id:f.employee.id,
    contracted_minutes:960,difference_minutes:-960}]);
  expect(await report('all')).toMatchObject([{employee_id:f.employee.id,worked_minutes:workedMinutes,
    contracted_minutes:7920,difference_minutes:workedMinutes-7920}]);
});

it.each([false,true])('September 30 23:00 Kuwait deletion without October sessions is absent (all branches: %s)', async (all) => {
  await f.h.owner`UPDATE employees SET deleted_at='2026-09-30T20:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(await report(all ? 'all' : f.branch)).toEqual([]);
});

it('all branches applies the deletion cutoff separately in each effective timezone', async () => {
  await f.h.owner`UPDATE branches SET timezone='UTC' WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  await f.h.owner`UPDATE employees SET deleted_at='2026-09-30T22:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(await report(f.secondBranch)).toEqual([]);
  expect(await report('all')).toMatchObject([{employee_id:f.employee.id,
    contracted_minutes:720,difference_minutes:-720}]);
});

it('September 20 deletion excludes the employee from October when there are no sessions', async () => {
  await f.h.owner`UPDATE employees SET deleted_at='2026-09-20T10:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(await report()).toEqual([]);
  expect(await report('all')).toEqual([]);
});

it('historical contracts still respect hire date, contract end and exclusive branch link end', async () => {
  await f.h.owner`UPDATE employees SET hire_date='2026-10-10',contract_end='2026-10-20'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-15'
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
  expect(await report()).toMatchObject([{contracted_minutes:2400,difference_minutes:-2400}]);
  expect(await report('all')).toMatchObject([{contracted_minutes:2880,difference_minutes:-2880}]);
});

it.each([false,true])('EXPLAIN ANALYZE keeps tenant indexes at the local deletion boundary (all branches: %s)', async (all) => {
  await f.h.owner`UPDATE employees SET deleted_at='2026-09-30T22:00:00Z'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const branches = [{id:f.branch,timezone:'Asia/Kuwait'}];
  if (all) branches.push({id:f.secondBranch,timezone:'UTC'});
  const scope = {businessId:f.business,branches};
  const plans = await f.db.withTenant(f.company,async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON)
      ${attendanceMonthlyInputsStatement(f.company,scope,'2026-10-01','2026-10-31')}`);
  });
  const plan = JSON.stringify(plans);
  expect(plan).toMatch(/employees_(pkey|company_business_id_idx)/);
  expect(plan).toMatch(/employee_default_shifts_(pkey|company_business_branch_idx)/);
  expect(plan).toMatch(/employee_branches_/);
});
