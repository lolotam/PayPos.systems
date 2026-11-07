import { termsFor } from './employees.fixture.ts';
import { leaveIds, type LeaveFixture } from './leave-history.fixture.ts';

export const performanceVolume = {
  employees: 50,
  days: 365,
  schedules: 2_650,
  shifts: 18_250,
  sessions: 18_250,
  leaves: 1_000,
};
export async function seedHistoryVolume(f: LeaveFixture) {
  const employees = [f.employee.id];
  for (let n = 1; n < performanceVolume.employees; n++) {
    const employee = await f.useCase.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: { ...termsFor(f, `Synthetic performance ${n}`), hire_date: '2025-01-01' },
    });
    employees.push(employee.id);
  }
  await f.h.owner`UPDATE employees SET hire_date='2025-01-01' WHERE company_id=${f.company}`;
  await f.h.owner`UPDATE employee_branches SET "from"='2025-01-01' WHERE company_id=${f.company}`;
  await seedSchedules(f, employees);
  const shifts = Array.from({ length: performanceVolume.shifts }, () => leaveIds.newId());
  const sessions = shifts.map(() => leaveIds.newId());
  await f.h
    .owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT ${f.company},s.id,sc.id,sc.employee_id,date '2025-11-07'+((s.n-1)%365)::int,
      (extract(dow FROM date '2025-11-07'+((s.n-1)%365)::int)::int+1)%7,'09:00','17:00',
      timestamptz '2025-11-07T09:00:00Z'+((s.n-1)%365)*interval '1 day',
      timestamptz '2025-11-07T17:00:00Z'+((s.n-1)%365)*interval '1 day'
    FROM unnest(${f.h.owner.array(shifts)}::uuid[]) WITH ORDINALITY s(id,n)
    JOIN staff_schedules sc ON sc.company_id=${f.company} AND sc.employee_id=(${f.h.owner.array(employees)}::uuid[])[((s.n-1)/365+1)::int]
    AND sc.week_start=(date '2025-11-07'+((s.n-1)%365)::int)-
      ((extract(dow FROM date '2025-11-07'+((s.n-1)%365)::int)::int+1)%7)`;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    SELECT sh.company_id,s.id,${f.business},${f.branch},sh.employee_id,sh.working_date,'UTC',
      sh.starts_at,sh.ends_at,'CLOSED','QR','EMPLOYEE','NONE',0
    FROM unnest(${f.h.owner.array(sessions)}::uuid[],${f.h.owner.array(shifts)}::uuid[]) s(id,shift)
    JOIN staff_schedule_shifts sh ON sh.company_id=${f.company} AND sh.id=s.shift`;
  await seedLeaves(f, employees);
  for (const table of [
    'employees',
    'staff_schedules',
    'staff_schedule_shifts',
    'attendance_sessions',
    'leave_requests',
  ])
    await f.h.owner.unsafe(`ANALYZE ${table}`);
}

async function seedSchedules(f: LeaveFixture, employees: string[]) {
  const scheduleIds = employees.flatMap(() => Array.from({ length: 53 }, () => leaveIds.newId()));
  const employeeIds = employees.flatMap((employee) => Array.from({ length: 53 }, () => employee));
  await f.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${f.company},s.id,${f.business},${f.branch},s.employee,date '2025-11-01'+((s.n-1)%53)::int*7,'UTC',1
    FROM unnest(${f.h.owner.array(scheduleIds)}::uuid[],${f.h.owner.array(employeeIds)}::uuid[]) WITH ORDINALITY s(id,employee,n)`;
}

async function seedLeaves(f: LeaveFixture, employees: string[]) {
  const leaves = Array.from({ length: performanceVolume.leaves }, () => leaveIds.newId());
  await f.h
    .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,
    starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    SELECT ${f.company},s.id,${f.business},${f.branch},(${f.h.owner.array(employees)}::uuid[])[((s.n-1)%50+1)::int],
      'FULL_DAY',date '2025-01-01'+s.n::int,date '2025-01-01'+s.n::int,'UTC',
      timestamptz '2025-01-01T00:00:00Z'+s.n*interval '1 day',
      timestamptz '2025-01-02T00:00:00Z'+s.n*interval '1 day',
      (ARRAY['ANNUAL','SICK','UNPAID'])[((s.n-1)%3+1)::int],'APPROVED',${f.userId},now(),${f.userId},now()
    FROM unnest(${f.h.owner.array(leaves)}::uuid[]) WITH ORDINALITY s(id,n)`;
}
