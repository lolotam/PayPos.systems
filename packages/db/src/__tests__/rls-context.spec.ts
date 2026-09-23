import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database, type Tx } from '../index.ts';

// Context-leak assertions (plan v4 T5, PRD P0-T5.6): a tenant setting must never outlive its transaction.
let testDb: TestDatabase;
let single: Database;
let pair: Database;

const { A, B } = TENANT;
const ids = { newId: () => '01920000-0000-7000-8000-0000000000c1' };

const businessIds = async (tx: Tx): Promise<string[]> =>
  Array.from(await tx.execute<{ id: string }>(sql`SELECT id FROM businesses ORDER BY id`)).map(
    (r) => r.id,
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  // One connection: every call reuses it, so a leaked setting would be visible to the next call.
  single = createDatabase({ url: testDb.appUrl, ids, maxConnections: 1 });
  pair = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});

afterAll(async () => {
  await single.close();
  await pair.close();
  await testDb.drop();
});

describe('one pooled connection, A → B → no tenant', () => {
  it('each call sees only its own tenant, and a user-only call sees none', async () => {
    expect(await single.withTenant(A.company, businessIds)).toEqual([A.business]);
    expect(await single.withTenant(B.company, businessIds)).toEqual([B.business]);
    expect(await single.withUser(USER, businessIds)).toEqual([]);
  });

  it('nothing survives a transaction that threw', async () => {
    await expect(
      single.withTenant(A.company, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await single.withUser(USER, businessIds)).toEqual([]);
  });

  it('nothing survives an explicit rollback', async () => {
    await expect(single.withTenant(A.company, async (tx) => tx.rollback())).rejects.toThrow();
    expect(await single.withUser(USER, businessIds)).toEqual([]);
  });
});

describe('concurrent transactions', () => {
  it('two open transactions do not see each other’s company', async () => {
    let release!: () => void;
    const bDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = pair.withTenant(A.company, async (tx) => {
      await bDone;
      return businessIds(tx);
    });
    const second = pair.withTenant(B.company, async (tx) => {
      const seen = await businessIds(tx);
      release();
      return seen;
    });
    expect(await Promise.all([first, second])).toEqual([[A.business], [B.business]]);
  });
});

describe('a session-level setting is overridden by the transaction-local one', () => {
  it('inside the transaction only the local company is visible', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await app`SELECT set_config('app.company_id', ${B.company}, false)`;
      const seen = await app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
        return tx`SELECT id FROM businesses`;
      });
      expect(Array.from(seen)).toEqual([{ id: A.business }]);
    } finally {
      await app.end();
    }
  });
});
