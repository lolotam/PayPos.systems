import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { monthlyReportFixture, reportHeaders, reportLeave, reportUrl, scopeReportReader,
  type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { hoursCommand } from './employee-default-shifts.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => {
  f = await monthlyReportFixture();
  await f.setHours.execute(hoursCommand(f,[{day:0,start:'09:00',end:'17:00'}]));
  await f.setHours.execute(hoursCommand(f,[{day:0,start:'18:00',end:'22:00'}],f.secondBranch));
});
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

async function contracted(branch: string) {
  const response = await f.h.app.inject({method:'GET',url:reportUrl(f,branch),headers:reportHeaders(f)});
  expect(response.statusCode).toBe(200);
  const rows = attendanceMonthlyReport.parse(response.json()).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.employee_id).toBe(f.employee.id);
  return rows[0]?.contracted_minutes;
}

it.each([
  ['FULL_DAY',[480,240,720]],
  ['PARTIAL',[120,0,120]],
] as const)('AB-Q11 Reem %s annual leave filed at Salmiya reduces Salmiya, Hawalli and all by their overlaps', async (kind, removed) => {
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  const branches = [f.branch,f.secondBranch,'all'];
  const baseline = [];
  for (const branch of branches) baseline.push(await contracted(branch));
  expect(baseline).toEqual([2400,1200,3600]);
  const id = await reportLeave(f,'ANNUAL',kind,'APPROVED','2026-10-03');
  if (kind === 'PARTIAL') await f.h.owner`UPDATE leave_requests SET start='10:00',"end"='12:00',
    starts_at='2026-10-03T07:00:00Z',ends_at='2026-10-03T09:00:00Z' WHERE company_id=${f.company} AND id=${id}`;
  for (const [index,branch] of branches.entries()) {
    expect(await contracted(branch)).toBe((baseline[index] ?? 0) - (removed[index] ?? 0));
  }
});

it('AB-Q11 a Hawalli-scoped reader gets employee leave filed at Salmiya without needing Salmiya access', async () => {
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  await reportLeave(f,'ANNUAL','FULL_DAY','APPROVED','2026-10-03');
  await scopeReportReader(f,'BRANCH',f.secondBranch);
  expect(await contracted(f.secondBranch)).toBe(960);
});
