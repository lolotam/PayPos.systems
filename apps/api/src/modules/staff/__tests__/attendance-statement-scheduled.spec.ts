import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceReportBranchInputs } from '@pospay/contracts';
import { attendanceStatementScheduledEmployeesStatement } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { employeeNameMatchKey, mergeAttendanceStatementRows } from '@pospay/domain';
import { attendanceMonthlyInputs, type AttendanceReportInputRow } from '../queries/attendance-monthly-report.query.ts';
import { monthlyReportFixture, reportSession, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

const FROM = '2026-10-01';
const TO = '2026-10-31';
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;
const scope = () => ({ businessId: f.business, branches: [{ id: f.branch, timezone: 'Asia/Kuwait' }] });

async function seedEmployee(name: string, business = f.business, branch = f.branch) {
  const id = salaryIds.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.company},${id},${business},${branch},${name},${employeeNameMatchKey(name)},'staff','2026-01-01',
      ${takeTestEmployeeNumber(f.company)})`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${salaryIds.newId()},${business},${id},${branch},'2026-01-01')`;
  return id;
}

async function seedShift(employeeId: string, date: string, weekStart: string, day: number,
  business = f.business, branch = f.branch) {
  const schedule = salaryIds.newId();
  await f.h.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${business},${branch},${employeeId},${weekStart},'Asia/Kuwait',1)`;
  await f.h.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${salaryIds.newId()},${schedule},${employeeId},${date},${day},'09:00','17:00',
      ${at(date, '09:00')},${at(date, '17:00')},null,null,null,null)`;
}

async function seedLeave(employeeId: string, date: string) {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - 3 * 3600000).toISOString();
  const end = new Date(Date.parse(`${date}T00:00:00Z`) + 21 * 3600000).toISOString();
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",
    timezone,starts_at,ends_at,type,note,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.branch},${employeeId},'FULL_DAY',${date},${date},null,null,
      'Asia/Kuwait',${start},${end},'ANNUAL','Synthetic leave','APPROVED',${f.userId},now(),${f.userId},now())`;
}

function scheduledRows() {
  return f.db.withTenant(f.company, (tx) => tx.execute<AttendanceReportInputRow>(
    attendanceStatementScheduledEmployeesStatement(
      f.company, f.business, { id: f.branch, timezone: 'Asia/Kuwait' }, FROM, TO,
    ),
  ));
}

it('FR-011b: an employee covered only by her schedule comes back with the context shift, no sessions and no contract', async () => {
  const employeeId = await seedEmployee('Schedule only');
  await seedShift(employeeId, '2026-09-30', '2026-09-26', 4);
  await seedShift(employeeId, '2026-10-05', '2026-10-03', 2);
  await seedLeave(employeeId, '2026-10-08');
  const rows = await scheduledRows();
  const row = rows.find((entry) => entry.employee_id === employeeId);
  expect(row).toBeDefined();
  expect(attendanceReportBranchInputs.safeParse(row?.branches[0]).success).toBe(true);
  const branch = row?.branches[0];
  expect(branch?.timezone).toBe('Asia/Kuwait');
  expect(branch?.sessions).toEqual([]);
  expect(branch?.contract).toBeNull();
  expect(branch?.shifts.map((shift) => shift.working_date)).toEqual(['2026-09-30', '2026-10-05']);
  expect(branch?.leave_for_branch).toHaveLength(1);
});

it('FR-011b: a 27b candidate comes back too, and the merge keeps her 27b row once', async () => {
  await seedShift(f.employee.id, '2026-10-06', '2026-10-03', 3);
  await reportSession(f, { date: '2026-10-06', start: '06:00', end: '14:00' });
  const scheduled = await scheduledRows();
  expect(scheduled.map((entry) => entry.employee_id)).toContain(f.employee.id);
  const reportRows = await f.db.withTenant(f.company, (tx) =>
    attendanceMonthlyInputs(tx, f.company, scope(), FROM, TO));
  const merged = mergeAttendanceStatementRows(reportRows, scheduled);
  const rows = merged.filter((entry) => entry.employee_id === f.employee.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.branches[0]?.sessions.length).toBeGreaterThan(0);
});

it('FR-011b: a shift at another branch, another business and a context-only shift are not returned', async () => {
  const otherBranch = await seedEmployee('Other branch');
  await seedShift(otherBranch, '2026-10-07', '2026-10-03', 4, f.business, f.secondBranch);
  const otherBusiness = await seedEmployee('Other business', f.secondBusiness, f.otherBranch);
  await seedShift(otherBusiness, '2026-10-07', '2026-10-03', 4, f.secondBusiness, f.otherBranch);
  const contextOnly = await seedEmployee('Context only');
  await seedShift(contextOnly, '2026-09-30', '2026-09-26', 4);
  const rows = await scheduledRows();
  const ids = rows.map((entry) => entry.employee_id);
  expect(ids).not.toContain(otherBranch);
  expect(ids).not.toContain(otherBusiness);
  expect(ids).not.toContain(contextOnly);
});

it('EXPLAIN ANALYZE reads the schedule through its branch-week index', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceStatementScheduledEmployeesStatement(
      f.company, f.business, { id: f.branch, timezone: 'Asia/Kuwait' }, FROM, TO,
    )}`);
  });
  expect(JSON.stringify(plans)).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
});
