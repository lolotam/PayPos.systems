import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { enrollFor, unbindFixture, type UnbindFixture } from './unbind-passkey.fixture.ts';
import { passkeyHistoryStatement } from '../queries/employee-passkeys.query.ts';
import { passkeyEmployeesStatement } from '../queries/passkey-employees.query.ts';
import { passkeyEmployeeScopeStatement } from '../queries/passkey-access.ts';

let f: UnbindFixture;
beforeAll(async () => {
  f = await unbindFixture();
  await enrollFor(f);
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
