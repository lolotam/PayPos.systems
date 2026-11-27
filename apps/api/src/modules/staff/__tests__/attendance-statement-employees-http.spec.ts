import { attendanceStatementEmployeeOptions } from '@pospay/contracts';
import {
  attendanceMonthlyInputsStatement,
  attendanceStatementScheduledEmployeesStatement,
} from '@pospay/db';
import {
  hasAttendanceStatementCoverage,
  mergeAttendanceStatementRows,
  type ReportBranchInputs,
} from '@pospay/domain';
import { createAttendanceStatementEmployeesReader } from '../persistence/attendance-statement-employees.read.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import {
  seedOpenStatementSession,
  seedStatementEmployee,
  seedStatementLeave,
  seedStatementSession,
  seedStatementShift,
} from './attendance-statement-http-seed.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: AttendanceStatementHttpFixture;
let scheduleOnly: string;
let futureShift: string;
let punchedAndScheduled: string;
let foreignEmployee: string;
let openOnly: string;
let missedUncorrected: string;
let missedCorrected: string;
let contractOnly: string;
let leaveOnContractDay: string;

beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
  // موظفة تغطيتها وردية جدولة خلصت قبل الطلب: من غير بصمة ولا عقد.
  scheduleOnly = await seedStatementEmployee(f, { name: 'Schedule only employee' });
  await seedStatementShift(f, scheduleOnly, {
    workingDate: '2026-10-05',
    start: '09:00',
    end: '17:00',
  });
  // موظفة ورديتها لسه ما خلصتش وقت الطلب: مش بتتغطى.
  futureShift = await seedStatementEmployee(f, { name: 'Future shift employee' });
  await seedStatementShift(f, futureShift, {
    workingDate: '2026-10-25',
    start: '09:00',
    end: '17:00',
  });
  // موظفة في مرشحي تقرير 27b وفي الجدول: بتظهر مرة واحدة.
  punchedAndScheduled = await seedStatementEmployee(f, { name: 'Punched and scheduled employee' });
  await seedStatementShift(f, punchedAndScheduled, {
    workingDate: '2026-10-05',
    start: '09:00',
    end: '17:00',
  });
  await seedStatementSession(f, punchedAndScheduled, '2026-10-06');
  await seedParityEdgeCases();
  // موظفة في شركة تانية بوردية خلصت في نفس الفترة: لو العزل اتكسر هتظهر في قائمة الشركة الأولى.
  foreignEmployee = await seedStatementEmployee(f, {
    name: 'Foreign company employee',
    companyId: f.otherCompany,
    businessId: f.foreignBusiness,
    branchId: f.foreignBranch,
  });
  await seedStatementShift(f, foreignEmployee, {
    workingDate: '2026-10-05',
    start: '09:00',
    end: '17:00',
    companyId: f.otherCompany,
    businessId: f.foreignBusiness,
    branchId: f.foreignBranch,
  });
});

async function seedMissedOut(employeeId: string, corrected: boolean) {
  const session = salaryIds.newId();
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end)
    VALUES(${f.company},${session},${f.business},${f.branch},${employeeId},'2026-10-07','Asia/Kuwait',
      '2026-10-07T06:00:00Z','2026-10-07T22:00:00Z','MISSED_OUT','QR','MISSED_OUT','NONE',0,null)`;
  if (!corrected) return;
  await f.h.owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,
    request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.branch},${employeeId},${session},${salaryIds.newId()},
      'CLOCK_OUT','2026-10-07T22:00:00Z','2026-10-07T14:00:00Z','Synthetic correction',${f.userId},now())`;
}

async function seedDefaultShifts(employeeId: string) {
  await f.h.owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",updated_by,updated_at)
    SELECT ${f.company},${f.business},${employeeId},${f.branch},d,'09:00'::time,'17:00'::time,${f.userId},now()
    FROM generate_series(0,6) AS d`;
}

/** حالات الحافة اللي لازم القائمة الخفيفة تطابق فيها المسار الكامل: مفتوحة، MISSED_OUT، عقد، إجازة. */
async function seedParityEdgeCases() {
  openOnly = await seedStatementEmployee(f, { name: 'Open session only employee' });
  await seedOpenStatementSession(f, openOnly, '2026-10-08');
  missedUncorrected = await seedStatementEmployee(f, { name: 'Missed out uncorrected employee' });
  await seedMissedOut(missedUncorrected, false);
  missedCorrected = await seedStatementEmployee(f, { name: 'Missed out corrected employee' });
  await seedMissedOut(missedCorrected, true);
  contractOnly = await seedStatementEmployee(f, { name: 'Contract only employee' });
  await seedDefaultShifts(contractOnly);
  leaveOnContractDay = await seedStatementEmployee(f, { name: 'Leave on contract day employee' });
  await seedDefaultShifts(leaveOnContractDay);
  await seedStatementLeave(f, leaveOnContractDay, '2026-10-28');
}

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function employees(
  from = '2026-10-01',
  to = '2026-10-31',
  options: { cookie?: string; company?: string; businessId?: string; branchId?: string } = {},
) {
  return f.h.send(
    'GET',
    `/v1/businesses/${options.businessId ?? f.business}/branches/${options.branchId ?? f.branch}/attendance-statement-employees?from=${from}&to=${to}`,
    { cookie: options.cookie ?? f.cookie, company: options.company ?? f.company },
  );
}

function listed(response: { body: Record<string, unknown> }) {
  return attendanceStatementEmployeeOptions.parse(response.body).employees;
}

it('lists the schedule-only employee and hides the one whose shift has not ended yet', async () => {
  const response = await employees();
  expect(response.status).toBe(200);
  const listedEmployees = listed(response);
  expect(listedEmployees.map((employee) => employee.employee_id)).toContain(scheduleOnly);
  expect(listedEmployees.map((employee) => employee.employee_id)).not.toContain(futureShift);
});

it('lists an employee who is a report candidate and scheduled only once, sorted by employee number', async () => {
  const listedEmployees = listed(await employees());
  const occurrences = listedEmployees.filter(
    (employee) => employee.employee_id === punchedAndScheduled,
  );
  expect(occurrences).toHaveLength(1);
  const numbers = listedEmployees.map((employee) => employee.employee_number);
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
});

it('refuses a branch outside the route business', async () => {
  const response = await employees('2026-10-01', '2026-10-31', {
    branchId: f.otherBusinessBranch,
  });
  expect(response.status).toBe(404);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND' });
});

it.each([
  ['2026-10-31', '2026-10-01'],
  ['2025-10-30', '2026-10-31'],
  ['2026-10-01', '2026-11-30'],
])('refuses the period from %s to %s', async (from, to) => {
  const response = await employees(from, to);
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
});

it('refuses a malformed period shape before reaching the reader', async () => {
  const response = await employees('not-a-date', '2026-10-31');
  expect(response.status).toBe(400);
});

it('refuses a caller without read:attendance:branch', async () => {
  const response = await employees('2026-10-01', '2026-10-31', { cookie: f.readerCookie });
  expect(response.status).toBe(403);
});

it('shows each company only its own employees', async () => {
  const own = listed(await employees()).map((employee) => employee.employee_id);
  expect(own).toContain(scheduleOnly);
  expect(own).not.toContain(foreignEmployee);
  const foreign = listed(
    await employees('2026-10-01', '2026-10-31', {
      company: f.otherCompany,
      businessId: f.foreignBusiness,
      branchId: f.foreignBranch,
    }),
  ).map((employee) => employee.employee_id);
  expect(foreign).toContain(foreignEmployee);
  expect(foreign).not.toContain(scheduleOnly);
  expect(foreign).not.toContain(punchedAndScheduled);
});

it('refuses another company reaching this company branch', async () => {
  const response = await employees('2026-10-01', '2026-10-31', { company: f.otherCompany });
  expect([403, 404]).toContain(response.status);
  expect(JSON.stringify(response.body)).not.toContain(scheduleOnly);
});

it('reads nothing of this branch when the reader runs under another company', async () => {
  const read = createAttendanceStatementEmployeesReader(f.db, {
    now: () => new Date('2026-10-23T07:00:00.000Z'),
  });
  await expect(
    read(
      { companyId: f.otherCompany, userId: f.userId, businessId: f.business, branchId: f.branch },
      { from: '2026-10-01', to: '2026-10-31' },
    ),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND' });
});

async function fullPipelineEmployeeIds(from: string, to: string): Promise<string[]> {
  const branch = { id: f.branch, timezone: 'Asia/Kuwait' };
  const cutoff = '2026-10-23T07:00:00.000Z';
  return f.db.withTenant(f.company, async (tx) => {
    type Row = { employee_id: string; employee_number: number; branches: ReportBranchInputs[] };
    const report = await tx.execute<Row>(
      attendanceMonthlyInputsStatement(f.company, { businessId: f.business, branches: [branch] }, from, to),
    );
    const scheduled = await tx.execute<Row>(
      attendanceStatementScheduledEmployeesStatement(f.company, f.business, branch, from, to),
    );
    return mergeAttendanceStatementRows(report, scheduled)
      .filter((row) => row.branches.some((entry) => hasAttendanceStatementCoverage(entry, { from, to }, cutoff, null)))
      .map((row) => row.employee_id);
  });
}

it.each([
  ['2026-10-01', '2026-10-31'],
  ['2026-10-24', '2026-10-31'],
  ['2026-10-06', '2026-10-06'],
])('lists the same employees as the full input pipeline for %s to %s', async (from, to) => {
  const light = listed(await employees(from, to)).map((employee) => employee.employee_id);
  expect(light.toSorted()).toEqual((await fullPipelineEmployeeIds(from, to)).toSorted());
});

it('covers an employee by a counted session, a corrected missed-out session or a contract day, never by an open or uncorrected one', async () => {
  const ids = listed(await employees()).map((employee) => employee.employee_id);
  expect(ids).toEqual(expect.arrayContaining([missedCorrected, contractOnly, leaveOnContractDay]));
  expect(ids).not.toContain(openOnly);
  expect(ids).not.toContain(missedUncorrected);
});

it('covers an employee by approved leave on a contract day when the period has not ended yet', async () => {
  const ids = listed(await employees('2026-10-24', '2026-10-31')).map((employee) => employee.employee_id);
  expect(ids).toContain(leaveOnContractDay);
  expect(ids).not.toContain(contractOnly);
});
