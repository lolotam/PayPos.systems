import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { TenantWrappers, Tx } from '@pospay/db';
import { createManagerPasskeyAccess } from '../persistence/manager-passkey-access.adapter.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import { employeePasskeys } from '../queries/employee-passkeys.query.ts';
import { passkeyEmployees } from '../queries/passkey-employees.query.ts';
import { managerPasskeyEmployee } from '../queries/passkey-access.ts';
import {
  enrollFor,
  managerFor,
  unbindFixture,
  type UnbindFixture,
} from './unbind-passkey.fixture.ts';

let f: UnbindFixture;
let input: { binding_id: string; revision: number; reason: string };
beforeAll(async () => {
  f = await unbindFixture();
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.companyId},${f.ids.newId()},${f.userId},id,'global','COMPANY',${f.companyId} FROM roles WHERE company_id IS NULL AND code='owner'`;
  const { binding } = await enrollFor(f);
  input = { ...binding, reason: 'Synthetic clock regression' };
});
afterAll(async () => {
  await f?.close();
});

async function unchanged() {
  const [binding] =
    await f.owner`SELECT revision,unbound_at FROM employee_passkeys WHERE id=${input.binding_id}`;
  expect(binding).toEqual({ revision: input.revision, unbound_at: null });
  expect(
    await f.owner`SELECT id FROM audit_log WHERE action='passkey.unbind' AND entity_id=${input.binding_id}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='EmployeePasskeyUnbound' AND aggregate_id=${f.employeeId}`,
  ).toHaveLength(0);
}

async function expiry() {
  const [row] = await f.owner`SELECT clock_timestamp()+interval '2 seconds' AS at`;
  return new Date(row?.['at'] as Date);
}

async function afterExpiry(expiresAt: Date) {
  while (true) {
    const [row] = await f.owner`SELECT clock_timestamp() AS at`;
    const at = new Date(row?.['at'] as Date);
    if (at.getTime() >= expiresAt.getTime()) return at;
    await delay(20);
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Uninitialized deferred');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function beforeExpiryDatabase(expiresAt: Date): TenantWrappers {
  return {
    ...f.database,
    withTenant: (company, work, options) =>
      f.database.withTenant(
        company,
        async (tx) => {
          const [row] = await tx.execute<{ at: Date }>(sql`SELECT now() AS at`);
          if (row === undefined) throw new Error('Missing transaction timestamp');
          expect(new Date(row.at).getTime()).toBeLessThan(expiresAt.getTime());
          return work(tx);
        },
        options,
      ),
  };
}

// قفل حقيقي ومعاملة بدأت قبل الانتهاء؛ نثبت الانتظار من PostgreSQL بدلاً من تخمينه بتأخير ثابت.
async function blockedUnbind(expiresAt: Date, scope = f.scope) {
  const acquired = deferred<number>();
  const release = deferred<undefined>();
  let held = true;
  let sampledAt = expiresAt;
  const clock = {
    now: vi.fn(() => {
      expect(held).toBe(false);
      return sampledAt;
    }),
  };
  const holder = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id=${f.companyId} FOR NO KEY UPDATE`;
    const [row] = await tx`SELECT pg_backend_pid() AS pid`;
    acquired.resolve(Number(row?.['pid']));
    await release.promise;
  });
  const pid = await acquired.promise;
  const database = beforeExpiryDatabase(expiresAt);
  const useCase = new UnbindPasskeyUseCase(createUnbindPasskeyTransactions(database, f.ids, clock));
  const outcome = useCase.execute(scope, input).then(
    () => 'COMMITTED',
    (error: Error) => error.message,
  );
  try {
    await vi.waitFor(
      async () => {
        const rows =
          await f.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))`;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 1500, interval: 10 },
    );
    expect(clock.now).not.toHaveBeenCalled();
    sampledAt = await afterExpiry(expiresAt);
    expect(clock.now).not.toHaveBeenCalled();
  } finally {
    held = false;
    release.resolve(undefined);
    await holder;
  }
  const result = await outcome;
  expect(clock.now).toHaveBeenCalledTimes(1);
  await unchanged();
  return result;
}

it('refuses an enabled feature override expiring while unbind waits on the company lock', async () => {
  const plan = f.ids.newId();
  await f.owner`INSERT INTO plans(id,code,name_en,feature_flags) VALUES(${plan},${plan},'Synthetic disabled staff','{"staff":false}')`;
  const [company] = await f.owner`SELECT plan_id FROM companies WHERE id=${f.companyId}`;
  await f.owner`UPDATE companies SET plan_id=${plan} WHERE id=${f.companyId}`;
  const at = await expiry();
  await f.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at)
    VALUES(${f.companyId},'staff',true,'Synthetic temporary staff',${f.manager.userId},${at})`;
  try {
    expect(await blockedUnbind(at)).toBe('FEATURE_DISABLED');
  } finally {
    await f.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.companyId} AND flag='staff'`;
    await f.owner`UPDATE companies SET plan_id=${company?.['plan_id']} WHERE id=${f.companyId}`;
  }
});

it('refuses a membership ending while unbind waits on the company lock', async () => {
  const manager = await managerFor(f, 'general_manager', 'COMPANY', f.companyId);
  const at = await expiry();
  await f.owner`UPDATE memberships SET ends_at=${at} WHERE id=${manager.membershipId}`;
  expect(await blockedUnbind(at, { ...f.scope, userId: manager.userId })).toBe('NOT_FOUND');
});

it('refuses an ALLOW permission expiring while unbind waits on the company lock', async () => {
  const role = f.ids.newId();
  await f.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.companyId},'synthetic_passkey_manager','Synthetic custom manager')`;
  const manager = await managerFor(f, 'branch_manager', 'BRANCH', f.branchId);
  await f.owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.companyId} WHERE id=${manager.membershipId}`;
  const at = await expiry();
  for (const permission of ['read:passkeys:branch', 'unbind:passkeys:branch'])
    await f.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
      VALUES(${f.companyId},${f.ids.newId()},${manager.membershipId},${permission},'ALLOW','BRANCH',${f.branchId},'Synthetic temporary authority',${f.manager.userId},${at})`;
  expect(await blockedUnbind(at, { ...f.scope, userId: manager.userId })).toBe('NOT_FOUND');
});

it('history, guard preflight and selector share one Clock sample across all access evaluations', async () => {
  const at = await expiry();
  const before = new Date(at.getTime() - 1);
  const clock = { now: vi.fn(() => before) };
  const access = createManagerPasskeyAccess(clock);
  await f.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at)
    VALUES(${f.companyId},'staff',false,'Synthetic read boundary',${f.manager.userId},${at})`;
  await f.owner`UPDATE memberships SET ends_at=${at} WHERE id=${f.manager.membershipId}`;
  // وقت المعاملة بعد الانتهاء، لكن القرار المحقون قبله؛ يكشف أي عودة خفية لساعة قاعدة البيانات.
  await afterExpiry(at);
  const reads: ((tx: Tx) => Promise<unknown>)[] = [
    (tx) => employeePasskeys(tx, f.scope, { limit: 20 }, access),
    (tx) => managerPasskeyEmployee(tx, f.scope, access),
    (tx) => passkeyEmployees(tx, f.scope, { limit: 20 }, access),
  ];
  for (const read of reads) {
    clock.now.mockClear();
    expect(await f.database.withTenant(f.companyId, read)).toSatisfy(
      (result: unknown) =>
        result === 'FEATURE_DISABLED' ||
        (typeof result === 'object' &&
          result !== null &&
          'featureEnabled' in result &&
          result.featureEnabled === false),
    );
    expect(clock.now).toHaveBeenCalledTimes(1);
  }
  await f.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.companyId} AND flag='staff'`;
  await f.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.manager.membershipId}`;
});

it('successful unbind samples once and persists the same decision timestamp', async () => {
  const now = new Date();
  const clock = { now: vi.fn(() => now) };
  const useCase = new UnbindPasskeyUseCase(
    createUnbindPasskeyTransactions(f.database, f.ids, clock),
  );
  expect(await useCase.execute(f.scope, input)).toMatchObject({ unbound_at: now.toISOString() });
  expect(clock.now).toHaveBeenCalledTimes(1);
  const [binding] =
    await f.owner`SELECT unbound_at FROM employee_passkeys WHERE id=${input.binding_id}`;
  expect(binding?.['unbound_at']).toEqual(now);
});
