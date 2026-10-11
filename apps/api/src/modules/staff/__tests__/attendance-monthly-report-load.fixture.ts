import { attendanceMonthDates, employeeNameMatchKey } from '@pospay/domain';
import { monthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

export async function monthlyReportLoadFixture() {
  const f = await monthlyReportFixture();
  const employees = Array.from({length:59},(_,index) => ({id:salaryIds.newId(),
    name:`Synthetic load employee ${index}`,key:employeeNameMatchKey(`Synthetic load employee ${index}`)}));
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.company},id,${f.business},${f.branch},name,key,'staff','2026-01-01'::date
    FROM jsonb_to_recordset(${f.h.owner.json(employees)}::jsonb) AS x(id uuid,name text,key text)`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    SELECT ${f.company},id,${f.business},employee_id,${f.branch},'2026-01-01'::date
    FROM jsonb_to_recordset(${f.h.owner.json(employees.map((entry) => ({id:salaryIds.newId(),employee_id:entry.id})))}::jsonb)
      AS x(id uuid,employee_id uuid)`;
  const employeeIds = [f.employee.id,...employees.map((entry) => entry.id)];
  await f.h.owner`DELETE FROM employee_default_shifts WHERE company_id=${f.company} AND branch_id=${f.branch}`;
  const defaults = employeeIds.flatMap((employee_id) => Array.from({length:7},(_,day) => ({employee_id,day})));
  await f.h.owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",updated_by,updated_at)
    SELECT ${f.company},${f.business},employee_id,${f.branch},day,'09:00'::time,'17:00'::time,${f.userId},now()
    FROM jsonb_to_recordset(${f.h.owner.json(defaults)}::jsonb) AS x(employee_id uuid,day smallint)`;
  const dates = attendanceMonthDates('2026-10');
  const weekOf = (date: string, weekday: number) => new Date(Date.parse(`${date}T00:00:00Z`)-weekday*86400000).toISOString().slice(0,10);
  const weeks = [...new Set(dates.map((entry) => weekOf(entry.date,entry.weekday)))];
  const schedules = employeeIds.flatMap((employee_id) => weeks.map((week_start) => ({id:salaryIds.newId(),employee_id,week_start})));
  await f.h.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${f.company},id,${f.business},${f.branch},employee_id,week_start,'Asia/Kuwait',1
    FROM jsonb_to_recordset(${f.h.owner.json(schedules)}::jsonb) AS x(id uuid,employee_id uuid,week_start date)`;
  const index = new Map(schedules.map((entry) => [`${entry.employee_id}:${entry.week_start}`,entry.id]));
  const shifts = employeeIds.flatMap((employee_id) => dates.map(({date,weekday}) => ({id:salaryIds.newId(),employee_id,
    schedule_id:index.get(`${employee_id}:${weekOf(date,weekday)}`),date,day:weekday})));
  await f.h.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    SELECT ${f.company},id,schedule_id,employee_id,date,day,'09:00','17:00',
      (date::text||'T06:00:00Z')::timestamptz,(date::text||'T14:00:00Z')::timestamptz,'13:00','14:00',
      (date::text||'T10:00:00Z')::timestamptz,(date::text||'T11:00:00Z')::timestamptz
    FROM jsonb_to_recordset(${f.h.owner.json(shifts)}::jsonb) AS x(id uuid,schedule_id uuid,employee_id uuid,date date,day int)`;
  await insertSessions(f,shifts);
  // قاعدة الاختبار المستنسخة كانت فارغة؛ الإحصاءات يجب أن تصف حمل الشهر قبل قياس خطة القراءة.
  await f.h.owner`ANALYZE employees,employee_branches,employee_default_shifts,staff_schedules,staff_schedule_shifts,attendance_sessions`;
  return f;
}

async function insertSessions(f: Awaited<ReturnType<typeof monthlyReportFixture>>, shifts: {employee_id:string;date:string}[]) {
  const sessions = shifts.flatMap((entry) => [['06:00','10:00'],['11:00','14:00']].map(([start,end]) => ({
    id:salaryIds.newId(),employee_id:entry.employee_id,date:entry.date,start,end,
  })));
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end)
    SELECT ${f.company},id,${f.business},${f.branch},employee_id,date,'Asia/Kuwait',
      (date::text||'T'||start||':00Z')::timestamptz,(date::text||'T'||"end"||':00Z')::timestamptz,
      'CLOSED','QR','EMPLOYEE','NONE',0,(date::text||'T14:00:00Z')::timestamptz
    FROM jsonb_to_recordset(${f.h.owner.json(sessions)}::jsonb) AS x(id uuid,employee_id uuid,date date,start text,"end" text)`;
}
