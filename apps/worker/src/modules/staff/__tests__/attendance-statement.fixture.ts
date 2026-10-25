import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, PROVISIONAL_PLAN_ID, type Database, type IdGenerator } from '@pospay/db';
import postgres from 'postgres';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createAttendanceStatementReader } from '../index.ts';
import { takeTestEmployeeNumber } from './test-employee-number.ts';

export const PERIOD_FROM = '2026-10-01';
export const PERIOD_TO = '2026-10-03';
/** الطلب اتعمل بعد ما الورديات خلصت، فكل الدوام المتعاقد بيتحسب. */
export const REQUESTED_AT = new Date('2026-10-04T08:00:00.000Z');
export const TIMEZONE = 'Asia/Kuwait';

export interface Tenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}

interface TenantOptions {
  /** اسم الفرع بالعربي؛ null معناه إن الفرع مالهوش اسم عربي. */
  readonly branchNameAr?: string | null;
}

interface EmployeeOptions {
  readonly nameEn?: string;
  readonly nameAr?: string | null;
  readonly hireDate?: string;
}

interface ShiftOptions {
  readonly workingDate: string;
  readonly day: number;
  readonly start: string;
  readonly end: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

interface SessionOptions {
  readonly workingDate: string;
  readonly clockIn: Date;
  readonly clockOut?: Date | null;
  readonly status?: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  readonly scheduledEnd?: Date | null;
  readonly lateMinutes?: number;
}

interface LeaveOptions {
  readonly from: string;
  readonly to: string;
  readonly type?: 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';
}

interface RequestOptions {
  readonly form?: 'BRANCH' | 'EMPLOYEE';
  readonly employeeId?: string | null;
  readonly from?: string;
  readonly to?: string;
  readonly language?: 'ar' | 'en';
  readonly shift?: { start: string; end: string } | null;
  readonly logoFileId?: string | null;
  readonly requestedBy?: string;
  readonly requestedAt?: Date;
}

interface IdentityOptions {
  readonly officialNameAr?: string | null;
  readonly officialNameEn?: string | null;
}

const COUNTED_TABLES = [
  'attendance_statement_requests',
  'attendance_sessions',
  'staff_schedules',
  'staff_schedule_shifts',
  'leave_requests',
  'employee_default_shifts',
  'employees',
  'employee_branches',
  'business_settings',
  'file_access_audit',
  'audit_log',
  'outbox',
];

/** فيكستشر كشف الحضور: شركة بفرع وموظفة ووردية، وقارئ البيان نفسه. */
export async function attendanceStatementFixture() {
  const ids = systemUuidV7();
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const db: Database = createDatabase({ url: testDb.appUrl, ids });
  const requesterId = await addUser(owner, ids, 'statement-requester');
  const reader = createAttendanceStatementReader(db);
  return {
    ids,
    owner,
    db,
    testDb,
    reader,
    requesterId,
    tenant: (options: TenantOptions = {}) => addTenant(owner, ids, requesterId, options),
    employee: (tenant: Tenant, options: EmployeeOptions = {}) =>
      addEmployee(owner, ids, tenant, options),
    defaultShifts: (tenant: Tenant, employeeId: string, days: readonly number[]) =>
      addDefaultShifts(owner, tenant, employeeId, days, requesterId),
    shift: (tenant: Tenant, employeeId: string, options: ShiftOptions) =>
      addShift(owner, ids, tenant, employeeId, options),
    session: (tenant: Tenant, employeeId: string, options: SessionOptions) =>
      addSession(owner, ids, tenant, employeeId, options),
    closeSession: (tenant: Tenant, sessionId: string, clockOut: Date) =>
      owner`UPDATE attendance_sessions SET status='CLOSED', closed_by='EMPLOYEE', clock_out=${clockOut}
        WHERE company_id=${tenant.company} AND id=${sessionId}`,
    voidSession: (tenant: Tenant, sessionId: string) =>
      voidSession(owner, ids, tenant, sessionId, requesterId),
    leave: (tenant: Tenant, employeeId: string, options: LeaveOptions) =>
      addLeave(owner, ids, tenant, employeeId, options, requesterId),
    identity: (tenant: Tenant, options: IdentityOptions = {}) =>
      addIdentity(owner, tenant, options),
    request: (tenant: Tenant, options: RequestOptions = {}) =>
      addRequest(owner, ids, tenant, options, requesterId),
    counts: (company: string) => rowCounts(owner, company),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export type AttendanceStatementFixture = Awaited<ReturnType<typeof attendanceStatementFixture>>;

async function addUser(owner: postgres.Sql, ids: IdGenerator, label: string): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${id},${label},${`${id}@example.test`})`;
  return id;
}

async function addTenant(
  owner: postgres.Sql,
  ids: IdGenerator,
  ownerUserId: string,
  options: TenantOptions,
): Promise<Tenant> {
  const company = ids.newId();
  const business = ids.newId();
  const branch = ids.newId();
  const branchNameAr = options.branchNameAr === undefined ? 'السالمية' : options.branchNameAr;
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
    VALUES(${company},'Synthetic statement',${ownerUserId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_ar,name_en,timezone)
    VALUES(${business},${company},'salon','صالون الأميرة','Princess Salon',${TIMEZONE})`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_ar,name_en,timezone)
    VALUES(${branch},${company},${business},${branchNameAr},'Salmiya',null)`;
  return { company, business, branch };
}

async function addEmployee(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  options: EmployeeOptions,
): Promise<string> {
  const id = ids.newId();
  const nameEn = options.nameEn ?? 'Sara';
  const nameAr = options.nameAr ?? null;
  const hireDate = options.hireDate ?? '2026-01-01';
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_ar_key,name_en_key,role_code,hire_date,employee_number)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${nameAr},${nameEn},
      ${nameAr === null ? null : employeeNameMatchKey(nameAr)},${employeeNameMatchKey(nameEn)},'staff',${hireDate},
      ${takeTestEmployeeNumber(tenant.company)})`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${tenant.company},${ids.newId()},${tenant.business},${id},${tenant.branch},${hireDate})`;
  return id;
}

async function addDefaultShifts(
  owner: postgres.Sql,
  tenant: Tenant,
  employeeId: string,
  days: readonly number[],
  userId: string,
): Promise<void> {
  for (const day of days) {
    await owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",updated_by,updated_at)
      VALUES(${tenant.company},${tenant.business},${employeeId},${tenant.branch},${day},'09:00','17:00',${userId},now())`;
  }
}

async function addShift(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  options: ShiftOptions,
): Promise<string> {
  const schedule = ids.newId();
  await owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${tenant.company},${schedule},${tenant.business},${tenant.branch},${employeeId},${weekStartOf(options.workingDate)},${TIMEZONE},1)`;
  const id = ids.newId();
  await owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${tenant.company},${id},${schedule},${employeeId},${options.workingDate},${options.day},${options.start},${options.end},
      ${options.startsAt},${options.endsAt})`;
  return id;
}

async function addSession(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  options: SessionOptions,
): Promise<string> {
  const id = ids.newId();
  const status = options.status ?? (options.clockOut == null ? 'OPEN' : 'CLOSED');
  const closedBy = status === 'OPEN' ? null : status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE';
  await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,closed_by,source,geo,late_minutes,scheduled_end)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${employeeId},${options.workingDate},${TIMEZONE},
      ${options.clockIn},${options.clockOut ?? null},${status},${closedBy},'QR','OK',${options.lateMinutes ?? 0},
      ${options.scheduledEnd ?? null})`;
  return id;
}

async function voidSession(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  sessionId: string,
  userId: string,
): Promise<void> {
  const request = ids.newId();
  await owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,
      kind,status,session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at)
    SELECT company_id,${request},business_id,branch_id,employee_id,'VOID_SESSION','APPROVED',id,revision,
      'Synthetic voided session',${userId},now(),${userId},now()
    FROM attendance_sessions WHERE company_id=${tenant.company} AND id=${sessionId}`;
  await owner`UPDATE attendance_sessions SET voided_at=now(),voided_by=${userId},void_request_id=${request},
    revision=revision+1 WHERE company_id=${tenant.company} AND id=${sessionId}`;
}

async function addLeave(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  options: LeaveOptions,
  userId: string,
): Promise<void> {
  const start = new Date(Date.parse(`${options.from}T00:00:00Z`) - 3 * 3_600_000).toISOString();
  const end = new Date(Date.parse(`${options.to}T00:00:00Z`) + 21 * 3_600_000).toISOString();
  await owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",
      timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${tenant.company},${ids.newId()},${tenant.business},${tenant.branch},${employeeId},'FULL_DAY',${options.from},${options.to},
      null,null,${TIMEZONE},${start},${end},${options.type ?? 'ANNUAL'},'APPROVED',${userId},now(),${userId},now())`;
}

async function addIdentity(
  owner: postgres.Sql,
  tenant: Tenant,
  options: IdentityOptions,
): Promise<void> {
  await owner`INSERT INTO business_settings(company_id,business_id,official_name_ar,official_name_en)
    VALUES(${tenant.company},${tenant.business},${options.officialNameAr ?? null},${options.officialNameEn ?? null})`;
}

async function addRequest(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  options: RequestOptions,
  userId: string,
): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO attendance_statement_requests(company_id,id,business_id,branch_id,form,employee_id,
      period_from,period_to,language,shift_start,shift_end,logo_file_id,requested_by,requested_at)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${options.form ?? 'BRANCH'},
      ${options.employeeId ?? null},${options.from ?? PERIOD_FROM},${options.to ?? PERIOD_TO},${options.language ?? 'ar'},
      ${options.shift?.start ?? null},${options.shift?.end ?? null},${options.logoFileId ?? null},
      ${options.requestedBy ?? userId},${options.requestedAt ?? REQUESTED_AT})`;
  return id;
}

async function rowCounts(owner: postgres.Sql, company: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const [row] = await owner.unsafe(
      `SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`,
      [company],
    );
    counts[table] = Number(row?.['n'] ?? 0);
  }
  return counts;
}

/** أول سبت في أسبوع يوم العمل؛ قيد الجدول بيطلب سبت. */
function weekStartOf(workingDate: string): string {
  const day = new Date(`${workingDate}T00:00:00Z`).getUTCDay();
  const start = Date.parse(`${workingDate}T00:00:00Z`) - ((day + 1) % 7) * 86_400_000;
  return new Date(start).toISOString().slice(0, 10);
}
