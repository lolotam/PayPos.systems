import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database, type Tx } from '../index.ts';
import { createTenantWrappers, type TenantWrappers } from '../with-tenant.ts';

// Context-leak assertions (plan v4 T5, PRD P0-T5.6). The wrappers run over a client with ONE connection
// that the test can also query directly, so the settings are read on the same backend right after the
// wrapper's transaction ends — before any other wrapper could overwrite them.
let testDb: TestDatabase;
let client: postgres.Sql;
let wrappers: TenantWrappers;
let pair: Database;

const { A, B } = TENANT;
const ids = { newId: () => '01920000-0000-7000-8000-0000000000c1' };

const businessIds = async (tx: Tx): Promise<string[]> =>
  Array.from(await tx.execute<{ id: string }>(sql`SELECT id FROM businesses ORDER BY id`)).map(
    (r) => r.id,
  );

const sessionContext = async () => {
  const [row] = await client`SELECT NULLIF(current_setting('app.company_id', true), '') AS company,
                                    NULLIF(current_setting('app.user_id', true), '') AS "user"`;
  return row;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  client = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  wrappers = createTenantWrappers(drizzle(client), ids);
  pair = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});

afterAll(async () => {
  await client.end();
  await pair.close();
  await testDb.drop();
});

describe('the wrapper’s settings end with its transaction', () => {
  it('after a commit the same connection holds no company and no user', async () => {
    expect(await wrappers.withTenant(A.company, businessIds, { userId: USER })).toEqual([
      A.business,
    ]);
    expect(await sessionContext()).toEqual({ company: null, user: null });
  });

  it('after a throw the same connection holds no company', async () => {
    await expect(
      wrappers.withTenant(A.company, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await sessionContext()).toEqual({ company: null, user: null });
  });

  it('after an explicit rollback the same connection holds no company', async () => {
    await expect(wrappers.withTenant(A.company, async (tx) => tx.rollback())).rejects.toThrow();
    expect(await sessionContext()).toEqual({ company: null, user: null });
  });
});

describe('a stale session-level setting cannot reach tenant data through the wrappers', () => {
  it('withUser sees no company and withTenant sees only its own, despite a session value of B', async () => {
    await client`SELECT set_config('app.company_id', ${B.company}, false)`;
    try {
      expect(await wrappers.withUser(USER, businessIds)).toEqual([]);
      expect(await wrappers.withTenant(A.company, businessIds)).toEqual([A.business]);
    } finally {
      await client`RESET app.company_id`;
    }
  });
});

describe('concurrent transactions', () => {
  it('two transactions open at the same time, on different backends, see only their own company', async () => {
    const arrived: Record<string, () => void> = {};
    const arrival = (label: string) =>
      new Promise<void>((resolve) => {
        arrived[label] = resolve;
      });
    const both = { A: arrival('A'), B: arrival('B') };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('rendezvous timed out')), 5_000),
    );

    const run = (label: 'A' | 'B', companyId: string, other: 'A' | 'B') =>
      pair.withTenant(companyId, async (tx) => {
        const [me] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        arrived[label]?.();
        await Promise.race([both[other], timeout]);
        return { pid: me?.pid, seen: await businessIds(tx) };
      });

    const [a, b] = await Promise.all([run('A', A.company, 'B'), run('B', B.company, 'A')]);
    expect(a.pid).not.toBe(b.pid);
    expect(a.seen).toEqual([A.business]);
    expect(b.seen).toEqual([B.business]);
  });
});
