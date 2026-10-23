import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport, attendanceReportBranchInputs } from '@pospay/contracts';
import { attendanceMonthlyInputsStatement } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceMonthlyInputs } from '../queries/attendance-monthly-report.query.ts';
import { monthlyReportFixture, reportSession, reportLeave, reportHeaders, reportUrl,
  voidReportSession, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: MonthlyReportFixture, missed: string;
beforeAll(async () => {
  f = await monthlyReportFixture();
  const end = '2026-10-03T14:00:00.000Z';
  await reportSession(f,{start:'06:00',end:'10:00',scheduledEnd:end,late:15});
  await reportSession(f,{start:'11:00',end:'14:00',scheduledEnd:end,late:30});
  await reportSession(f,{date:'2026-10-04',end:'09:00',source:'MANUAL',late:10});
  missed = await reportSession(f,{date:'2026-10-05',end:'22:00',status:'MISSED_OUT',late:12});
  await voidReportSession(f,await reportSession(f,{date:'2026-10-06'}));
  await reportSession(f,{date:'2026-10-07',status:'OPEN'});
  const overnight = await reportSession(f,{date:'2026-10-08',start:'19:00',end:'23:00'});
  await f.h.owner`UPDATE attendance_sessions SET clock_out='2026-10-09T03:00:00Z' WHERE company_id=${f.company} AND id=${overnight}`;
  await reportSession(f,{branch:f.secondBranch,start:'15:00',end:'17:00'});
  await seedReportShift();
});
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
const scope = () => ({businessId:f.business,branches:[{id:f.branch,timezone:'Asia/Kuwait'}]});
const get = async (branch = f.branch) => {
  const response = await f.h.app.inject({method:'GET',url:reportUrl(f,branch),headers:reportHeaders(f)});
  expect(response.statusCode).toBe(200);
  return attendanceMonthlyReport.parse(response.json());
};
async function seedReportShift() {
  const schedule = salaryIds.newId();
  await f.h.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${f.business},${f.branch},${f.employee.id},'2026-10-03','Asia/Kuwait',1)`;
  await f.h.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${salaryIds.newId()},${schedule},${f.employee.id},'2026-10-03',0,'09:00','17:00',
      '2026-10-03T06:00:00Z','2026-10-03T14:00:00Z','13:00','14:00','2026-10-03T10:00:00Z','2026-10-03T11:00:00Z')`;
}

it('AB-Q6/Q9g, BW-Q8, ACR-Q18/Q20: counted hours, break credit, MANUAL, voided/OPEN exclusion and overnight attribution', async () => {
  const view = await get();
  expect(view.rows).toHaveLength(1);
  expect(view.rows[0]).toMatchObject({employee_id:f.employee.id,days_present:3,worked_minutes:1140,
    scheduled_minutes:480,contracted_minutes:13680,difference_minutes:-12540,
    late_count:4,late_minutes:67,manual_days:1,missing_clock_out:1});
  const empty = await f.h.app.inject({method:'GET',url:reportUrl(f).replace('2026-10','2026-11'),headers:reportHeaders(f)});
  expect(attendanceMonthlyReport.parse(empty.json()).rows[0]?.worked_minutes).toBe(0);
});
it('AB-Q7 all sums branch hours/contracts in one employee row, with distinct working dates', async () => {
  const branch = (await get(f.secondBranch)).rows[0];
  expect(branch).toMatchObject({worked_minutes:120,contracted_minutes:2400,days_present:1});
  expect((await get('all')).rows).toMatchObject([{employee_id:f.employee.id,worked_minutes:1260,
    contracted_minutes:16080,days_present:3,difference_minutes:-14820}]);
});
it('result-shape projects internal branch inputs, excludes private fields and has a negative tenant isolation proof', async () => {
  const rows = await f.db.withTenant(f.company,(tx) => attendanceMonthlyInputs(tx,f.company,scope(),'2026-10-01','2026-10-31'));
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['branches','employee_id','employee_number','name_ar','name_en']);
  expect(attendanceReportBranchInputs.safeParse(rows[0]?.branches[0]).success).toBe(true);
  expect(rows[0]?.branches[0]?.sessions).toHaveLength(5);
  const foreign = await f.db.withTenant(f.otherCompany,(tx) => attendanceMonthlyInputs(tx,f.company,scope(),'2026-10-01','2026-10-31'));
  expect(foreign).toEqual([]);
});
it('EXPLAIN ANALYZE proves existing board, correction, schedule, default and leave indexes without a migration', async () => {
  await reportLeave(f);
  const plans = await f.db.withTenant(f.company,async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceMonthlyInputsStatement(f.company,scope(),'2026-10-01','2026-10-31')}`);
  });
  const plan = JSON.stringify(plans);
  expect(plan).toMatch(/attendance_sessions_(board|business_date|employee_date)_idx/);
  expect(plan).toContain('attendance_corrections_session_idx');
  expect(plan).toMatch(/staff_schedule_shifts_(schedule|employee|company_starts)_idx/);
  expect(plan).toMatch(/employee_default_shifts_(pkey|company_business_branch_idx)/);
  expect(plan).toMatch(/leave_requests_(company_(business_branch|employee|branch)|no_overlap)/);
});
it('AB-Q4 removes approved full day and partial overlap only, ignoring pending leave', async () => {
  expect((await get()).rows[0]?.contracted_minutes).toBe(13200);
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  await reportLeave(f,'SICK','PARTIAL');
  await reportLeave(f,'UNPAID','FULL_DAY','PENDING','2026-10-05');
  const row = (await get()).rows[0];
  expect(row).toMatchObject({contracted_minutes:13620,difference_minutes:1140-13620});
  expect(row?.leave).toContainEqual({type:'SICK',days:0,partial_minutes:120});
  expect(row?.leave).toContainEqual({type:'UNPAID',days:0,partial_minutes:0});
});
it('AB-Q6 CLOCK_IN-only correction does not count MISSED_OUT; CLOCK_OUT correction counts corrected hours while status stays MISSED_OUT', async () => {
  const request = salaryIds.newId();
  await f.h.owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,
    request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.branch},${f.employee.id},${missed},${request},
      'CLOCK_IN','2026-10-05T05:00:00Z','2026-10-05T06:00:00Z','Synthetic correction',${f.userId},now())`;
  expect((await get()).rows[0]?.worked_minutes).toBe(1140);
  await f.h.owner`UPDATE attendance_sessions SET clock_out='2026-10-05T15:00:00Z' WHERE company_id=${f.company} AND id=${missed}`;
  await f.h.owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,
    request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.branch},${f.employee.id},${missed},${request},
      'CLOCK_OUT','2026-10-05T22:00:00Z','2026-10-05T15:00:00Z','Synthetic correction',${f.userId},now())`;
  expect((await get()).rows[0]).toMatchObject({worked_minutes:1680,days_present:4,missing_clock_out:0,late_count:4,late_minutes:67});
  const [row] = await f.h.owner`SELECT status FROM attendance_sessions WHERE company_id=${f.company} AND id=${missed}`;
  expect(row?.status).toBe('MISSED_OUT');
});
it('historical sessions remain visible after the employee branch link ends', async () => {
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-01' WHERE company_id=${f.company}
    AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
  expect((await get()).rows[0]).toMatchObject({worked_minutes:1680,contracted_minutes:0});
});
