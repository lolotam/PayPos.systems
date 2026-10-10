import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { enrollFor, unbindFixture, type UnbindFixture } from './unbind-passkey.fixture.ts';
import {
  employeePasskeys,
  passkeyHistoryStatement,
  passkeyStatusStatement,
} from '../queries/employee-passkeys.query.ts';
import { passkeyEmployeesStatement } from '../queries/passkey-employees.query.ts';
import { passkeyEmployeeScopeStatement } from '../queries/passkey-access.ts';
import { createManagerPasskeyAccess } from '../persistence/manager-passkey-access.adapter.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import { lockEmployee, prepareLockEnrol, PHONE_X, PHONE_Y } from './passkey-device-lock.fixture.ts';

let f: UnbindFixture;
let legacy: Awaited<ReturnType<typeof enrollFor>>;
let locked: Awaited<ReturnType<typeof lockEmployee>>;
let binding: Awaited<ReturnType<Awaited<ReturnType<typeof prepareLockEnrol>>['execute']>>;
beforeAll(async () => {
  f = await unbindFixture();
  legacy = await enrollFor(f);
  locked = await lockEmployee(f);
  binding = await (await prepareLockEnrol(f, locked, PHONE_Y)).execute();
});
afterAll(async () => {
  await f?.close();
});
it('history, selector and employee scope expose only safe columns and have tenant-index plans', async () => {
  const days = [{ branchId: f.branchId, today: '2026-10-04' }];
  const statements = [
    passkeyHistoryStatement(f.companyId, f.employeeId, { limit: 20 }),
    passkeyEmployeesStatement(f.companyId, f.businessId, [f.branchId], { limit: 20 }, days),
    passkeyEmployeeScopeStatement(f.scope, days),
  ];
  for (const statement of statements) {
    const plan = await f.database.withTenant(f.companyId, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement}`);
    });
    expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    const selected = new PgDialect().sqlToQuery(statement).sql.split('FROM')[0];
    for (const forbidden of ['public_key', 'credential_id', 'passkey_id', 'reason'])
      expect(selected).not.toContain(forbidden);
  }
  const historyPlan = await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statements[0]}`);
  });
  expect(JSON.stringify(historyPlan)).toContain('employee_passkeys_employee_cursor_idx');
});

it('phone status distinguishes enrollment, legacy attachment and unbound history without exposing hashes', async () => {
  const read = (employeeId: string) =>
    f.database.withTenant(f.companyId, (tx) =>
      employeePasskeys(
        tx,
        { ...f.scope, employeeId },
        { limit: 20 },
        createManagerPasskeyAccess({ now: () => new Date() }),
      ),
    );
  expect(await read(f.employeeId)).toMatchObject({
    status: {
      bound: true,
      phone_locked: false,
      phone_locked_since: null,
    },
  });
  const attachedAt = '2026-10-10T12:34:56.789Z';
  await f.owner`UPDATE employee_passkeys SET installation_hash=${installationHash(f.companyId, PHONE_X)},installation_locked_at=${attachedAt} WHERE id=${legacy.binding.binding_id}`;
  expect(await read(f.employeeId)).toMatchObject({
    status: {
      bound: true,
      phone_locked: true,
      phone_locked_since: attachedAt,
    },
  });
  const result = await read(locked.employeeId);
  if (result === null || result === 'FEATURE_DISABLED') throw new Error('MISSING_TEST_STATUS');
  expect(result.status).toEqual({
    bound: true,
    binding_id: binding.binding_id,
    revision: binding.revision,
    bound_at: binding.bound_at,
    phone_locked: true,
    phone_locked_since: binding.bound_at,
  });
  expect(JSON.stringify(result)).not.toContain('installation');
  await f.unbind.execute(f.scope, { ...legacy.binding, reason: 'Synthetic status release' });
  expect(await read(f.employeeId)).toMatchObject({
    status: {
      bound: false,
      binding_id: null,
      revision: null,
      bound_at: null,
      phone_locked: false,
      phone_locked_since: null,
    },
  });
});

interface PlanNode {
  'Index Name'?: string;
  'Actual Loops': number;
  Plans?: PlanNode[];
}
function usedIndexes(plan: PlanNode): string[] {
  return [
    ...(plan['Index Name'] !== undefined && plan['Actual Loops'] > 0 ? [plan['Index Name']] : []),
    ...(plan.Plans ?? []).flatMap(usedIndexes),
  ];
}

it('phone status EXPLAIN executes only the indexed binding lookup', async () => {
  const plan = await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(sql`EXPLAIN (ANALYZE,FORMAT JSON)
      ${passkeyStatusStatement(f.companyId, locked.employeeId)}`);
  });
  const root = plan[0]?.['QUERY PLAN'][0]?.Plan;
  if (root === undefined) throw new Error('MISSING_TEST_PLAN');
  expect(usedIndexes(root)).toEqual(['employee_passkeys_active_employee_key']);
  expect(JSON.stringify(root)).not.toContain('audit_log');
});
