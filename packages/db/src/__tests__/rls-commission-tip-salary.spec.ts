import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
  expectPgError,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertTipSalary,
  projectionTables,
  tipSalaryIds as ids,
} from '../../test/commission-tip-salary-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const { A, B } = COMMISSION_TENANT;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: ReturnType<typeof sql>) => db.withTenant(B.company, (tx) => tx.execute(query));

it.each(projectionTables)('%s isolates reads and writes', async (table) => {
  const id = ids.newId();
  const session = ids.newId();
  const effectiveFrom = '2026-11-02';
  await db.withTenant(A.company, async (tx) => {
    if (table === 'commission_tips')
      await insertTipSalary(tx, 'commission_tip_heads', A, { session });
    await insertTipSalary(tx, table, A, { id, session, effectiveFrom });
  });
  const target = sql.identifier(table);
  expect(await asA(sql`SELECT id FROM ${target} WHERE id=${id}`)).toEqual([{ id }]);
  expect(await asB(sql`SELECT id FROM ${target} WHERE id=${id}`)).toEqual([]);
  await expectPgError(
    db.withTenant(B.company, (tx) => insertTipSalary(tx, table, A, { session })),
    '42501',
  );
  if (table !== 'commission_tips') {
    expect(await asB(sql`UPDATE ${target} SET revision=99 WHERE id=${id} RETURNING id`)).toEqual(
      [],
    );
    await expectPgError(
      asA(sql`UPDATE ${target} SET company_id=${B.company} WHERE id=${id}`),
      '42501',
    );
    expect(await asA(sql`SELECT revision FROM ${target} WHERE id=${id}`)).toEqual([
      { revision: 1 },
    ]);
  } else {
    expect(await asB(sql`DELETE FROM ${target} WHERE id=${id} RETURNING id`)).toEqual([]);
    await expectPgError(asA(sql`UPDATE ${target} SET amount='1.000' WHERE id=${id}`), '42501');
  }
  await expectPgError(asA(sql`TRUNCATE ${target}`), '42501');
  expect(await asA(sql`SELECT id FROM ${target} WHERE id=${id}`)).toEqual([{ id }]);
});

it('allows the same UUID and session in different companies and retains an empty head', async () => {
  const id = ids.newId();
  const session = ids.newId();
  for (const tenant of [A, B])
    await db.withTenant(tenant.company, async (tx) => {
      await insertTipSalary(tx, 'commission_tip_heads', tenant, { id, session });
      await insertTipSalary(tx, 'commission_tips', tenant, { id, session });
      await insertTipSalary(tx, 'commission_salaries', tenant, { id, effectiveFrom: '2026-11-30' });
    });
  await asA(sql`DELETE FROM commission_tips WHERE session_id=${session}`);
  await asA(sql`UPDATE commission_tip_heads SET revision=2 WHERE session_id=${session}`);
  expect(
    await asA(sql`SELECT revision FROM commission_tip_heads WHERE session_id=${session}`),
  ).toEqual([{ revision: 2 }]);
  expect(await asA(sql`SELECT id FROM commission_tips WHERE session_id=${session}`)).toEqual([]);
  expect(await asB(sql`SELECT id FROM commission_tips WHERE session_id=${session}`)).toEqual([
    { id },
  ]);
  await expectPgError(asA(sql`DELETE FROM commission_tip_heads WHERE id=${id}`), '42501');
  await expectPgError(asA(sql`DELETE FROM commission_salaries`), '42501');
});

it('leaves no tenant context outside transactions or after a rolled-back transaction', async () => {
  await expect(
    db.withTenant(A.company, async (tx) => {
      await insertTipSalary(tx, 'commission_tip_heads', A);
      throw new Error('test rollback');
    }),
  ).rejects.toThrow('test rollback');
  const app = postgres(testDb.appUrl, { max: 1 });
  try {
    for (const table of projectionTables)
      expect(await app`SELECT id FROM ${app(table)}`).toEqual([]);
  } finally {
    await app.end();
  }
});

it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  '%s cannot read the projections',
  async (url) => {
    const role = postgres(testDb[url], { max: 1 });
    try {
      for (const table of projectionTables)
        await expect(role`SELECT id FROM ${role(table)}`).rejects.toThrow(/permission denied/);
    } finally {
      await role.end();
    }
  },
);
