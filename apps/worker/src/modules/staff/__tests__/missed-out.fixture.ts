import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createDatabase, PROVISIONAL_PLAN_ID, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { persistAttendance } from '../../../../../api/src/modules/staff/persistence/attendance-writes.ts';
import { DetectMissedOuts } from '../use-cases/detect-missed-outs/detect-missed-outs.ts';
import { missedOutTransactions } from '../persistence/missed-out.transactions.ts';
import type { MissedOutTransactions } from '../ports/missed-out.port.ts';

export const H = 60 * 60 * 1000;
export interface Tenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}
export { TENANT };

/** قاعدة اختبار مستنسخة لكل ملف، والوظيفة تعمل كـ pospay_app فقط. */
export async function missedOutFixture() {
  const ids = systemUuidV7();
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const db: Database = createDatabase({ url: testDb.appUrl, ids });
  const userId = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic missed-out staff','missed-out-staff@example.test')`;
  let instant = new Date('2026-10-05T20:00:00Z');
  const clock = { now: () => new Date(instant) };
  const transactions = missedOutTransactions(db, ids);
  return {
    ids,
    owner,
    db,
    userId,
    clock,
    transactions,
    setNow: (at: Date) => {
      instant = at;
    },
    detect: (port: MissedOutTransactions = transactions) => new DetectMissedOuts(port, clock),
    tenant: () => newTenant(owner, userId, ids.newId(), ids.newId(), ids.newId()),
    employee: (tenant: Tenant) => newEmployee(owner, ids.newId(), tenant),
    open: (tenant: Tenant, employeeId: string, clockIn: Date, scheduledEnd: Date | null = null) =>
      openSession(owner, ids.newId(), tenant, employeeId, clockIn, scheduledEnd),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type MissedOutFixture = Awaited<ReturnType<typeof missedOutFixture>>;

async function newTenant(
  owner: postgres.Sql,
  userId: string,
  company: string,
  business: string,
  branch: string,
): Promise<Tenant> {
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${company},'Synthetic missed-out',${userId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${business},${company},'salon','Synthetic missed-out')`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${branch},${company},${business},'Synthetic missed-out')`;
  return { company, business, branch };
}

async function newEmployee(owner: postgres.Sql, id: string, tenant: Tenant) {
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},'Synthetic missed-out employee','staff','2026-01-01')`;
  return id;
}

async function openSession(
  owner: postgres.Sql,
  id: string,
  tenant: Tenant,
  employeeId: string,
  clockIn: Date,
  scheduledEnd: Date | null,
) {
  await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes,scheduled_start,scheduled_end)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},${employeeId},${clockIn.toISOString().slice(0, 10)},'Asia/Kuwait',${clockIn},'OPEN','QR','OK',0,
      ${scheduledEnd === null ? null : new Date(clockIn.getTime() + H)},${scheduledEnd})`;
  return id;
}

/** ربط passkey حقيقي في الجداول كي يكتب مسار PR 22 out_binding_id بقيود FK الفعلية. */
export async function bindPasskey(f: MissedOutFixture, tenant: Tenant, employeeId: string) {
  const passkeyId = f.ids.newId(),
    bindingId = f.ids.newId();
  await f.owner`INSERT INTO passkey(id,user_id,credential_id,public_key,counter,device_type,backed_up)
    VALUES(${passkeyId},${f.userId},${`synthetic-credential-${passkeyId}`},'synthetic-public-key',0,'singleDevice',false)`;
  await f.owner`INSERT INTO employee_passkeys(company_id,id,business_id,employee_id,passkey_id,revision,bound_at,bound_by)
    VALUES(${tenant.company},${bindingId},${tenant.business},${employeeId},${passkeyId},1,clock_timestamp(),${f.userId})`;
  return { bindingId, passkeyId };
}

/** مسح PR 22 حقيقي للإغلاق: يقفل State أولاً ثم يستدعي persistAttendance نفسه، مع بوابة لترتيب السباق. */
export function scanClose(
  f: MissedOutFixture,
  tenant: Tenant,
  employeeId: string,
  session: { id: string; clockIn: Date },
  binding: { bindingId: string; passkeyId: string },
  hooks: { locked?: () => void; gate?: Promise<void> } = {},
) {
  const { context, write } = closeWrite(tenant, session, binding, f.clock.now());
  const scope = {
    userId: f.userId,
    sessionId: f.ids.newId(),
    companyId: tenant.company,
    businessId: tenant.business,
    employeeId,
  };
  const scan = { token: { branch_id: tenant.branch, window: 1, sig: 'synthetic' } };
  return f.db.withTenant(
    tenant.company,
    async (tx) => {
      await tx.execute(sql`SELECT employee_id FROM attendance_states
        WHERE company_id=${tenant.company} AND employee_id=${employeeId} FOR UPDATE`);
      hooks.locked?.();
      await hooks.gate;
      await persistAttendance(tx, scope, scan, context, write, f.ids);
    },
    { userId: f.userId },
  );
}

function closeWrite(
  tenant: Tenant,
  session: { id: string; clockIn: Date },
  binding: { bindingId: string; passkeyId: string },
  at: Date,
) {
  const open = {
    id: session.id,
    clockIn: session.clockIn,
    workingDate: session.clockIn.toISOString().slice(0, 10),
    lateMinutes: 0,
    branchId: tenant.branch,
  };
  const context = {
    location: undefined,
    ...binding,
    bindingRevision: 1,
    timezone: 'Asia/Kuwait',
    geo: null,
    qrContext: 'ab'.repeat(32),
    lastAt: null,
    lastResult: null,
    open,
    shifts: [],
  };
  const write = {
    result: {
      session_id: session.id,
      operation: 'CLOCK_OUT' as const,
      working_date: open.workingDate,
      accepted_at: at.toISOString(),
      exceptions: [],
      late_minutes: 0,
      missed_session_id: null,
    },
    open,
    closeAt: at,
    geo: 'OK' as const,
    at,
    schedule: null,
  };
  return { context, write };
}

/** ينتظر حتى يقف backend على قفل صف، أي أن الطرف الآخر وصل إلى State ولم يتجاوزه. */
export async function lockWaiter(f: MissedOutFixture): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = await f.owner`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row?.['n']) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('NO_LOCK_WAITER');
}
