import { employeeNameMatchKey } from '@pospay/domain';

import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';
import type { AttendanceStatementApiFixture } from './attendance-statement-api.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

export interface StatementEmployeeOptions {
  companyId?: string;
  businessId?: string;
  branchId?: string;
  hireDate?: string;
  name?: string;
}

/** موظفة اصطناعية في نشاط وفرع، بدوام افتراضي وسجل ارتباط من يوم التعيين. */
export async function seedStatementEmployee(
  f: AttendanceStatementApiFixture,
  options: StatementEmployeeOptions = {},
) {
  const id = salaryIds.newId();
  const name = options.name ?? 'Synthetic statement employee';
  const companyId = options.companyId ?? f.company;
  const businessId = options.businessId ?? f.business;
  const branchId = options.branchId ?? f.branch;
  const hireDate = options.hireDate ?? '2026-01-01';
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${companyId},${id},${businessId},${branchId},${name},${employeeNameMatchKey(name)},'staff',${hireDate},${takeTestEmployeeNumber(companyId)})`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${companyId},${salaryIds.newId()},${businessId},${id},${branchId},${hireDate})`;
  return id;
}

const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

/** يوم الأسبوع بترتيب الدوام: السبت صفر والجمعة ستة. */
export function statementWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7;
}

/** السبت اللي يقع فيه يوم العمل؛ جدول الموظفات بيتثبت على السبت. */
export function statementWeekStart(date: string): string {
  const start = Date.parse(`${date}T00:00:00Z`);
  const daysSinceSaturday = statementWeekday(date);
  return new Date(start - daysSinceSaturday * 86_400_000).toISOString().slice(0, 10);
}

export interface StatementShiftOptions {
  workingDate: string;
  start: string;
  end: string;
  endsOn?: string;
  branchId?: string;
}

/** وردية مجدولة لموظفة؛ الموظفة الواحدة ليها جدول واحد في الأسبوع. */
export async function seedStatementShift(
  f: AttendanceStatementApiFixture,
  employeeId: string,
  options: StatementShiftOptions,
) {
  const schedule = salaryIds.newId();
  const weekStart = statementWeekStart(options.workingDate);
  await f.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${f.business},${options.branchId ?? f.branch},${employeeId},${weekStart},'Asia/Kuwait',1)`;
  await f.h
    .owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${salaryIds.newId()},${schedule},${employeeId},${options.workingDate},
      ${statementWeekday(options.workingDate)},${options.start},${options.end},
      ${at(options.workingDate, options.start)},${at(options.endsOn ?? options.workingDate, options.end)},
      null,null,null,null)`;
}

/** جلسة محتسبة في يوم عمل: مغلقة وساعة خروج مسجّلة. */
export async function seedStatementSession(
  f: AttendanceStatementApiFixture,
  employeeId: string,
  workingDate: string,
  options: { branchId?: string; scheduledEnd?: string } = {},
) {
  const scheduledEnd = options.scheduledEnd ?? null;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${options.branchId ?? f.branch},${employeeId},${workingDate},'Asia/Kuwait',
      ${`${workingDate}T06:00:00.000Z`},${`${workingDate}T14:00:00.000Z`},'CLOSED','QR','EMPLOYEE','NONE',0,${scheduledEnd})`;
}

/** جلسة مفتوحة؛ الجلسة المفتوحة ما بتتحسبش حضور (AB-Q9g). */
export async function seedOpenStatementSession(
  f: AttendanceStatementApiFixture,
  employeeId: string,
  workingDate: string,
  branchId = f.branch,
) {
  // الجلسة المفتوحة ما بتسجلش من قفلها، والقيد بيمنع وجود ساعة خروج أو قفل معاها.
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${branchId},${employeeId},${workingDate},'Asia/Kuwait',
      ${`${workingDate}T06:00:00.000Z`},null,'OPEN','QR',null,'NONE',0,null)`;
}

/** إجازة-approved ليوم عمل واحد؛ بتغطي يوم العقد بس. */
export async function seedStatementLeave(
  f: AttendanceStatementApiFixture,
  employeeId: string,
  workingDate: string,
  branchId = f.branch,
) {
  // اليوم الكامل بينتهي محلياً بمنتصف ليل اليوم التالي، ونهاية الفترة مستبعدة.
  const startsAt = new Date(Date.parse(`${workingDate}T00:00:00Z`) - 3 * 3_600_000).toISOString();
  const endsAt = new Date(Date.parse(`${workingDate}T00:00:00Z`) + 21 * 3_600_000).toISOString();
  await f.h
    .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",
    timezone,starts_at,ends_at,type,note,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${salaryIds.newId()},${f.business},${branchId},${employeeId},'FULL_DAY',${workingDate},${workingDate},
      null,null,'Asia/Kuwait',${startsAt},${endsAt},'ANNUAL','Synthetic statement leave','APPROVED',${f.userId},now(),${f.userId},now())`;
}

/** ملف شعار جاهز؛ ربطه بالنشاط قرار منفصل عن الطلب. */
export async function seedLogoFile(f: AttendanceStatementApiFixture, businessId = f.business) {
  const id = salaryIds.newId();
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,branch_id,owner_module,owner_entity_id,
      staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${f.company},${id},${businessId},null,'settings',${businessId},${`staging-${id}`},${`storage-${id}`},
      'image/png',10,'manage:business-identity:business',${f.userId},now(),'READY')`;
  return id;
}
