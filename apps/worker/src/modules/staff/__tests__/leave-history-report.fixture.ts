import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { employeeNameMatchKey } from '@pospay/domain';
import type {
  LeaveHistoryReportStoredQuery,
  LeaveHistoryReportStoredScope,
} from '@pospay/contracts';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { takeTestEmployeeNumber } from './test-employee-number.ts';

const AS_OF = new Date('2026-11-07T10:00:00.000Z');
const FAR_FUTURE = new Date('2027-01-01T00:00:00.000Z');

type LeaveStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED';

interface EmployeeInput {
  name: string;
  branchId?: string;
  attachments?: readonly { branchId: string; to?: string | null }[];
}

interface LeaveInput {
  employeeId: string;
  branchId?: string;
  date?: string;
  to?: string;
  status?: LeaveStatus;
  type?: 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';
}

interface ShiftInput {
  employeeId: string;
  branchId?: string;
  date?: string;
  startsAt?: string;
  endsAt?: string;
}

interface ReportInput {
  asOf?: Date;
  deadlineAt?: Date;
  expiresAt?: Date;
  scope?: postgres.JSONValue;
  query?: postgres.JSONValue;
  createdBy?: string;
  companyId?: string;
  businessId?: string;
}

interface FixtureContext {
  owner: postgres.Sql;
  ids: ReturnType<typeof systemUuidV7>;
  company: string;
  business: string;
  branch: string;
  secondBranch: string;
}

async function seedWorkspace(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
): Promise<FixtureContext> {
  const { company, business, branch } = TENANT.A;
  const secondBranch = ids.newId();
  await owner`INSERT INTO "user"(id,name,email)
    VALUES(${USER},'Synthetic leave reporter','leave-reporter@example.test')
    ON CONFLICT (id) DO NOTHING`;
  await owner`UPDATE businesses SET timezone='Asia/Kuwait' WHERE id=${business}`;
  await owner`UPDATE branches SET timezone='Asia/Kuwait' WHERE id=${branch}`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en,timezone)
    VALUES(${secondBranch},${company},${business},'Honolulu','Pacific/Honolulu')`;
  return { owner, ids, company, business, branch, secondBranch };
}

function storedScope(
  branch: string,
  secondBranch: string,
  branchIds: readonly string[] = [branch, secondBranch],
): LeaveHistoryReportStoredScope {
  return {
    branches: [...branchIds],
    attendanceBranches: [...branchIds],
    cancelBranches: [...branchIds],
    decideBranches: [...branchIds],
    revokeBranches: [...branchIds],
    createBranches: [...branchIds],
    eligibilityBranchIds: [...branchIds],
  };
}

function storedQuery(
  overrides: Partial<LeaveHistoryReportStoredQuery> = {},
): LeaveHistoryReportStoredQuery {
  return {
    from: '2026-11-01',
    to: '2026-11-07',
    'types[]': [],
    'statuses[]': [],
    ...overrides,
  };
}

async function seedEmployee(context: FixtureContext, input: EmployeeInput) {
  const { owner, ids, company, business, branch, secondBranch } = context;
  const id = ids.newId();
  const primaryBranch = input.branchId ?? branch;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,
    name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${id},${business},${primaryBranch},${input.name},
      ${employeeNameMatchKey(input.name)},'staff','2026-01-01',${takeTestEmployeeNumber(company)})`;
  const attachments = input.attachments ?? [
    { branchId: branch, to: null },
    { branchId: secondBranch, to: null },
  ];
  for (const attachment of attachments)
    await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES(${company},${ids.newId()},${business},${id},${attachment.branchId},
        '2026-01-01',${attachment.to ?? null})`;
  return id;
}

async function seedLeave(context: FixtureContext, input: LeaveInput) {
  const { owner, ids, company, business, branch } = context;
  const id = ids.newId();
  const date = input.date ?? '2026-11-05';
  const to = input.to ?? date;
  const status = input.status ?? 'APPROVED';
  const decided = status === 'APPROVED' || status === 'REJECTED';
  await owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,
    kind,"from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,
    decided_by,decided_at,rejection_reason,cancelled_by,cancelled_at)
    VALUES(${company},${id},${business},${input.branchId ?? branch},${input.employeeId},
      'FULL_DAY',${date},${to},'UTC',
      ${date}::date::timestamp AT TIME ZONE 'UTC',
      (${to}::date+1)::timestamp AT TIME ZONE 'UTC',
      ${input.type ?? 'ANNUAL'},${status},${USER},${AS_OF},
      ${decided ? USER : null},${decided ? AS_OF : null},
      ${status === 'REJECTED' ? 'Synthetic rejection' : null},
      ${status === 'CANCELLED' ? USER : null},${status === 'CANCELLED' ? AS_OF : null})`;
  return id;
}

async function seedShift(context: FixtureContext, input: ShiftInput) {
  const { owner, ids, company, business, branch } = context;
  const date = input.date ?? '2026-11-06';
  const branchId = input.branchId ?? branch;
  const schedule = ids.newId();
  const [saved] = await owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,
    employee_id,week_start,timezone,revision)
    VALUES(${company},${schedule},${business},${branchId},${input.employeeId},
      ${date}::date-((extract(dow FROM ${date}::date)::int+1)%7),'UTC',1)
    ON CONFLICT(company_id,employee_id,branch_id,week_start)
    DO UPDATE SET revision=staff_schedules.revision RETURNING id`;
  const id = ids.newId();
  await owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,
    working_date,day,start,"end",starts_at,ends_at)
    VALUES(${company},${id},${saved?.['id'] as string},${input.employeeId},${date},
      (extract(dow FROM ${date}::date)::int+1)%7,'09:00','17:00',
      ${input.startsAt ?? `${date}T01:00:00.000Z`},${input.endsAt ?? `${date}T02:00:00.000Z`})`;
  return id;
}

async function seedBaseHistory(context: FixtureContext) {
  const first = await seedEmployee(context, { name: 'History employee one' });
  const second = await seedEmployee(context, { name: 'History employee two' });
  const absent = await seedEmployee(context, { name: 'History absent employee' });
  await seedLeave(context, { employeeId: first, date: '2026-11-05' });
  await seedLeave(context, { employeeId: first, date: '2026-11-04', status: 'PENDING' });
  await seedLeave(context, { employeeId: second, date: '2026-11-03', status: 'REJECTED' });
  await seedLeave(context, { employeeId: second, date: '2026-11-02' });
  await seedShift(context, { employeeId: absent });
  return { first, second, absent };
}

async function insertPendingReport(context: FixtureContext, input: ReportInput) {
  const { owner, ids, company, business, branch, secondBranch } = context;
  const id = ids.newId();
  await owner`INSERT INTO leave_history_reports(company_id,id,business_id,created_by,
    query,fingerprint,scope,as_of,deadline_at,expires_at)
    VALUES(${input.companyId ?? company},${id},${input.businessId ?? business},
      ${input.createdBy ?? USER},${owner.json(input.query ?? storedQuery())},${'a'.repeat(64)},
      ${owner.json(input.scope ?? storedScope(branch, secondBranch))},${input.asOf ?? AS_OF},
      ${input.deadlineAt ?? FAR_FUTURE},${input.expiresAt ?? FAR_FUTURE})`;
  return id;
}

/** قاعدة مستقلة للعامل؛ القبول محفوظ كصف مالك لأن منتج API خارج هذا الجزء. */
export async function leaveHistoryReportFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 6, onnotice: () => undefined });
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const context = await seedWorkspace(owner, ids);
  const employees = await seedBaseHistory(context);
  const { company, business, branch, secondBranch } = context;

  return {
    db,
    owner,
    ids,
    clock: { value: AS_OF },
    company,
    business,
    branch,
    secondBranch,
    otherCompany: TENANT.B.company,
    otherBusiness: TENANT.B.business,
    createdBy: USER,
    employees,
    scope: (branchIds?: readonly string[]) => storedScope(branch, secondBranch, branchIds),
    query: storedQuery,
    employee: (input: EmployeeInput) => seedEmployee(context, input),
    leave: (input: LeaveInput) => seedLeave(context, input),
    shift: (input: ShiftInput) => seedShift(context, input),
    pendingReport: (input: ReportInput = {}) => insertPendingReport(context, input),
    report: (id: string) => owner`SELECT * FROM leave_history_reports WHERE id=${id}`,
    rows: (id: string) =>
      owner`SELECT * FROM leave_history_report_rows WHERE report_id=${id} ORDER BY seq`,
    async close() {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export type LeaveHistoryReportFixture = Awaited<ReturnType<typeof leaveHistoryReportFixture>>;
