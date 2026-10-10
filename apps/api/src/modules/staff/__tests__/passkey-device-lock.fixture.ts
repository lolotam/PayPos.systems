import { employeeNameMatchKey } from '@pospay/domain';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import type { personalFixture } from '../../../../test/personal-staff.fixture.ts';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { testAuthenticator } from '../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts';
import { createPasskeyTransactions } from '../persistence/passkey-transactions.ts';
import { createAttendanceDeviceRefusals } from '../persistence/attendance-device-refusals.ts';
import { EnrolPasskey } from '../use-cases/enrol-passkey/enrol-passkey.ts';
import type { PasskeyScope } from '../ports/passkeys.port.ts';

export const PHONE_X = '12345678-1234-4234-8234-123456789abc';
export const PHONE_Y = '87654321-4321-4321-8321-cba987654321';
type Fixture = Awaited<ReturnType<typeof personalFixture>>;

export async function lockEmployee(f: Fixture, samePerson = false, secondBusiness = false) {
  const userId = samePerson ? f.userId : f.ids.newId();
  const employeeId = f.ids.newId();
  const businessId = secondBusiness ? f.ids.newId() : f.businessId;
  const branchId = secondBusiness ? f.ids.newId() : f.branchId;
  if (!samePerson)
    await f.owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic colleague',${userId + '@example.test'})`;
  if (secondBusiness) {
    await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.companyId},${businessId},'Synthetic business','salon')`;
    await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branchId},${businessId},'Synthetic branch')`;
  }
  const name = 'Synthetic ' + employeeId;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${employeeId},${businessId},${branchId},${userId},${name},${employeeNameMatchKey(name)},'staff','2026-01-01')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${userId},id,'global','BRANCH',${branchId},'2026-01-01'::timestamptz FROM roles WHERE code='staff' AND company_id IS NULL`;
  return {
    companyId: f.companyId,
    businessId,
    branchId,
    employeeId,
    userId,
    sessionId: f.ids.newId(),
  };
}

export function lockEnrol(f: Fixture, database: TenantWrappers = f.database) {
  return new EnrolPasskey(
    f.auth.passkeys,
    createPasskeyTransactions(database, f.ids),
    f.ids,
    { now: () => new Date() },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );
}

export async function prepareLockEnrol(f: Fixture, scope: PasskeyScope, installationId?: string) {
  const device = testAuthenticator(true);
  const generated = await f.auth.passkeys.enrollmentOptions(scope);
  const response = device.registration(generated.options.challenge, personalOrigin, 'localhost');
  return {
    device,
    execute: (database: TenantWrappers = f.database) =>
      lockEnrol(f, database).execute(scope, generated.challengeId, response, installationId),
  };
}

export async function lockEffects(f: Fixture, employeeId: string) {
  const [row] = await f.owner`SELECT
    (SELECT count(*)::int FROM attendance_sessions WHERE employee_id=${employeeId}) AS sessions,
    (SELECT count(*)::int FROM attendance_device_signals WHERE employee_id=${employeeId}) AS signals,
    (SELECT count(*)::int FROM employee_passkeys WHERE employee_id=${employeeId}) AS bindings,
    (SELECT count(*)::int FROM audit_log) AS audits,
    (SELECT count(*)::int FROM outbox) AS events,
    (SELECT count(*)::int FROM idempotency_keys) AS idempotency`;
  return row;
}

function transactionGate(database: TenantWrappers) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pid: number | undefined;
  const wrapped: TenantWrappers = {
    ...database,
    withTenant: (companyId, work, options) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
          await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout='5s'`);
          const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
          try {
            return await work(tx);
          } finally {
            pid = backend?.pid;
            await released;
          }
        },
        options,
      ),
  };
  return { database: wrapped, release: () => release(), pid: () => pid };
}

// نوقف المعاملة قبل COMMIT أو ROLLBACK ونثبت انتظار المنافس فعلياً، فلا يعتمد السباق على سرعة الجهاز.
export async function coordinatedLockRace(
  f: Fixture,
  first: (database: TenantWrappers) => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const gate = transactionGate(f.database);
  const outcomes = [Promise.allSettled([first(gate.database)])];
  try {
    await vi.waitFor(() => expect(gate.pid()).toBeDefined(), { timeout: 3000, interval: 10 });
    const pid = gate.pid();
    if (pid === undefined) throw new Error('MISSING_TEST_BACKEND');
    outcomes.push(Promise.allSettled([second()]));
    await vi.waitFor(
      async () => {
        const rows = await f.owner`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))`;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 1500, interval: 10 },
    );
  } finally {
    gate.release();
    await Promise.all(outcomes);
  }
  return (await Promise.all(outcomes)).flat();
}
