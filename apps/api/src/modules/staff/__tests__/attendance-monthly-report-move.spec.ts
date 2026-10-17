import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { annualLeaveCsvCells, monthlyReportFixture, reportHeaders, reportLeave, reportUrl,
  type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { hoursCommand } from './employee-default-shifts.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => {
  f = await monthlyReportFixture();
  const defaults = Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' }));
  await f.setHours.execute(hoursCommand(f, defaults));
  await f.setHours.execute(hoursCommand(f, defaults, f.secondBranch));
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-15'
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.employee.id},${f.secondBranch},'2026-10-15')`;
});
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

it.each([
  ['2026-10-10', 'FULL_DAY', [1, 0, 1]],
  ['2026-10-20', 'FULL_DAY', [0, 1, 1]],
  ['2026-10-10', 'PARTIAL', [120, 0, 120]],
  ['2026-10-20', 'PARTIAL', [0, 120, 120]],
] as const)('%s %s leave is scoped to the employee branch on that date in JSON and CSV', async (date, kind, expected) => {
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  const id = await reportLeave(f, 'ANNUAL', kind, 'APPROVED', date);
  if (kind === 'PARTIAL') await f.h.owner`UPDATE leave_requests SET start='10:00',"end"='12:00',
    starts_at=${`${date}T07:00:00Z`},ends_at=${`${date}T09:00:00Z`} WHERE company_id=${f.company} AND id=${id}`;
  const baseline = [14 * 480, 17 * 480, 31 * 480];
  for (const [index, branch] of [f.branch, f.secondBranch, 'all'].entries()) {
    const response = await f.h.app.inject({ method: 'GET', url: reportUrl(f, branch), headers: reportHeaders(f) });
    expect(response.statusCode).toBe(200);
    const rows = attendanceMonthlyReport.parse(response.json()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employee_id).toBe(f.employee.id);
    const value = expected[index] ?? 0;
    expect(rows[0]?.leave).toContainEqual({ type: 'ANNUAL', days: kind === 'FULL_DAY' ? value : 0,
      partial_minutes: kind === 'PARTIAL' ? value : 0 });
    expect(rows[0]?.contracted_minutes).toBe((baseline[index] ?? 0) - (kind === 'FULL_DAY' ? value * 480 : value));
    const csv = await f.h.app.inject({ method: 'GET', url: reportUrl(f, branch, true), headers: reportHeaders(f) });
    expect(csv.statusCode).toBe(200);
    expect(annualLeaveCsvCells(csv.payload)).toEqual(kind === 'FULL_DAY' ? [`"${value}"`, '"0.00"'] : ['"0"', `"${(value / 60).toFixed(2)}"`]);
  }
});
