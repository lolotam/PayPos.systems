import { t } from '@pospay/i18n';
import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import postgres from 'postgres';
import { createDatabase, PROVISIONAL_PLAN_ID, type Database, type IdGenerator } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { notClockedInTransactions } from '../persistence/not-clocked-in.transactions.ts';
import type { NotClockedInTransactions } from '../ports/not-clocked-in.port.ts';
import { DetectNotClockedIns } from '../use-cases/detect-not-clocked-in/detect-not-clocked-in.ts';

export const WEEK = '2026-10-03';
export const WORKING = '2026-10-04';
export const SHIFT_START = new Date('2026-10-04T07:00:00.000Z');
export const SHIFT_END = new Date('2026-10-04T15:00:00.000Z');
export const ALERT_AT = new Date('2026-10-04T07:20:00.000Z');
export const ROLE = {
  owner: '01920000-0000-7000-8000-000000000101',
  general_manager: '01920000-0000-7000-8000-000000000102',
  business_manager: '01920000-0000-7000-8000-000000000104',
  branch_manager: '01920000-0000-7000-8000-000000000105',
  cashier: '01920000-0000-7000-8000-000000000107',
} as const;

export interface Tenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}
export interface ShiftClock {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly start: string;
  readonly end: string;
  readonly day: number;
  readonly workingDate: string;
  readonly week: string;
}
const STANDARD: ShiftClock = {
  startsAt: SHIFT_START,
  endsAt: SHIFT_END,
  start: '10:00',
  end: '18:00',
  day: 1,
  workingDate: WORKING,
  week: WEEK,
};

const NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

/** قاعدة اختبار مستنسخة، والوظيفة وقراءة المستلمين تعملان كـ pospay_app فقط. */
export async function notClockedInFixture() {
  const ids = systemUuidV7();
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const db: Database = createDatabase({ url: testDb.appUrl, ids });
  let instant = ALERT_AT;
  const clock = { now: () => new Date(instant) };
  const userId = await addUser(owner, ids, 'owner');
  const transactions = notClockedInTransactions(db, ids, branchPlaceAdapter);
  return {
    ids,
    owner,
    db,
    testDb,
    transactions,
    setNow: (at: Date) => {
      instant = at;
    },
    detect: (port: NotClockedInTransactions = transactions) =>
      new DetectNotClockedIns(port, clock, NAME_FALLBACK),
    tenant: () => addTenant(owner, ids, userId),
    business: (company: string) => addBusiness(owner, ids, company),
    branch: (tenant: Tenant, business = tenant.business) => addBranch(owner, ids, tenant, business),
    user: (label: string) => addUser(owner, ids, label),
    employee: (tenant: Tenant, options: EmployeeOptions = {}) =>
      addEmployee(owner, ids, tenant, options),
    shift: (tenant: Tenant, employeeId: string, clocking: Partial<ShiftClock> = {}) =>
      addShift(owner, ids, tenant, employeeId, { ...STANDARD, ...clocking }),
    removeShift: (company: string, shiftId: string) =>
      owner`DELETE FROM staff_schedule_shifts WHERE company_id=${company} AND id=${shiftId}`,
    leave: (tenant: Tenant, employeeId: string, input: LeaveInput) =>
      addLeave(owner, ids, userId, tenant, employeeId, input),
    clockIn: (tenant: Tenant, employeeId: string, at: Date, branch = tenant.branch) =>
      addClockIn(owner, ids, tenant, employeeId, at, branch),
    member: (input: MemberInput) => addMember(owner, ids, input),
    closeCompany: (company: string, at: Date) =>
      owner`UPDATE companies SET deleted_at=${at} WHERE id=${company}`,
    endContract: (tenant: Tenant, employeeId: string, contractEnd: string | null) =>
      owner`UPDATE employees SET contract_end=${contractEnd} WHERE company_id=${tenant.company} AND id=${employeeId}`,
    deleteEmployee: (tenant: Tenant, employeeId: string, at: Date) =>
      owner`UPDATE employees SET deleted_at=${at} WHERE company_id=${tenant.company} AND id=${employeeId}`,
    notices: (company: string, employeeId: string) =>
      owner`SELECT id, recipient_count, shift_starts_at, alert_due_at FROM attendance_not_clocked_in_notices
        WHERE company_id=${company} AND employee_id=${employeeId} ORDER BY shift_starts_at`,
    events: (company: string) =>
      owner`SELECT id, payload FROM outbox WHERE company_id=${company} AND event_type='ShiftNotClockedIn' ORDER BY seq`,
    audit: (company: string, noticeId: string) =>
      owner`SELECT actor_user_id, entity, action FROM audit_log WHERE company_id=${company} AND entity_id=${noticeId}`,
    inbox: (eventId: string) =>
      owner`SELECT recipient_user_id, template_key FROM in_app_notifications WHERE source_event_id=${eventId}`,
    attempts: (eventId: string) =>
      owner`SELECT id FROM notification_attempts WHERE source_event_id=${eventId}`,
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type NotClockedInFixture = Awaited<ReturnType<typeof notClockedInFixture>>;

interface EmployeeOptions {
  readonly nameEn?: string;
  readonly nameAr?: string | null;
  readonly userId?: string | null;
  readonly contractEnd?: string | null;
  readonly deletedAt?: Date | null;
}
interface LeaveInput {
  readonly kind: 'FULL_DAY' | 'PARTIAL';
  readonly status: 'APPROVED' | 'PENDING';
  readonly from: string;
  readonly to: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}
interface MemberInput {
  readonly tenant: Tenant;
  readonly userId: string;
  readonly roleId: string;
  readonly scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
  readonly startsAt?: string;
  readonly endsAt?: string | null;
}

async function addUser(owner: postgres.Sql, ids: IdGenerator, label: string) {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${id},${label},${`${id}@example.test`})`;
  return id;
}

async function addTenant(owner: postgres.Sql, ids: IdGenerator, userId: string): Promise<Tenant> {
  const company = ids.newId();
  const business = ids.newId();
  const branch = ids.newId();
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${company},'Synthetic not-clocked-in',${userId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${business},${company},'salon','Synthetic business')`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${branch},${company},${business},'Salmiya')`;
  return { company, business, branch };
}

async function addBusiness(owner: postgres.Sql, ids: IdGenerator, company: string) {
  const id = ids.newId();
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${id},${company},'salon','Other business')`;
  return id;
}

async function addBranch(owner: postgres.Sql, ids: IdGenerator, tenant: Tenant, business: string) {
  const id = ids.newId();
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${id},${tenant.company},${business},'Other branch')`;
  return id;
}

async function addEmployee(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  options: EmployeeOptions,
) {
  const id = ids.newId();
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,role_code,hire_date,contract_end,deleted_at)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${options.userId ?? null},${options.nameAr ?? null},
      ${options.nameEn ?? 'Laila'},'staff','2026-01-01',${options.contractEnd ?? null},${options.deletedAt ?? null})`;
  return id;
}

async function addShift(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  clocking: ShiftClock,
) {
  const schedule = await scheduleId(owner, ids, tenant, employeeId, clocking.week);
  const id = ids.newId();
  await owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${tenant.company},${id},${schedule},${employeeId},${clocking.workingDate},${clocking.day},${clocking.start},${clocking.end},${clocking.startsAt},${clocking.endsAt})`;
  return id;
}

async function scheduleId(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  week: string,
) {
  const [existing] = await owner`SELECT id FROM staff_schedules
    WHERE company_id=${tenant.company} AND employee_id=${employeeId} AND branch_id=${tenant.branch} AND week_start=${week}`;
  if (existing !== undefined) return String(existing['id']);
  const id = ids.newId();
  await owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${employeeId},${week},'Asia/Kuwait',1)`;
  return id;
}

async function addLeave(
  owner: postgres.Sql,
  ids: IdGenerator,
  userId: string,
  tenant: Tenant,
  employeeId: string,
  input: LeaveInput,
) {
  const approved = input.status === 'APPROVED';
  await owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${tenant.company},${ids.newId()},${tenant.business},${tenant.branch},${employeeId},${input.kind},${input.from},${input.to},
      ${input.start},${input.end},'Asia/Kuwait',${input.startsAt},${input.endsAt},'ANNUAL',${input.status},${userId},${input.startsAt},
      ${approved ? userId : null},${approved ? input.startsAt : null})`;
}

async function addClockIn(
  owner: postgres.Sql,
  ids: IdGenerator,
  tenant: Tenant,
  employeeId: string,
  at: Date,
  branch: string,
) {
  const id = ids.newId();
  await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    VALUES(${tenant.company},${id},${tenant.business},${branch},${employeeId},${at.toISOString().slice(0, 10)},'Asia/Kuwait',${at},'OPEN','QR','OK',0)`;
  return id;
}

async function addMember(owner: postgres.Sql, ids: IdGenerator, input: MemberInput) {
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.tenant.company},${ids.newId()},${input.userId},${input.roleId},'global',${input.scopeType},${input.scopeId},
      ${input.startsAt ?? '2026-01-01T00:00:00Z'},${input.endsAt ?? null})`;
}

/** ينتظر حتى يقف اتصال على قفل صف، أي أن الطرف الآخر وصل إلى State ولم يتجاوزه. */
export async function lockWaiter(owner: postgres.Sql): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = await owner`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row?.['n']) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('NO_LOCK_WAITER');
}
