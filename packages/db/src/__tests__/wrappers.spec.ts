import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database, type Tx } from '../index.ts';

const COMPANY_A = '0190a000-0000-7000-8000-00000000000a';
const USER_1 = '0190a000-0000-7000-8000-000000000001';
const NEW_COMPANY = '0190a000-0000-7000-8000-0000000000ff';

interface Context {
  company: string | null;
  user: string | null;
  role: string;
}

const readContext = async (tx: Tx): Promise<Context> => {
  const rows = await tx.execute<{ company: string | null; user: string | null; role: string }>(
    sql`SELECT app_company_id() AS company, app_user_id() AS "user", current_user AS role`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row;
};

let testDb: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  // Pool of one: every wrapper reuses the same connection, so a leaked setting would show up.
  database = createDatabase({
    url: testDb.appUrl,
    ids: { newId: () => NEW_COMPANY },
    maxConnections: 1,
  });
});

afterAll(async () => {
  await database.close();
  await testDb.drop();
});

describe('withTenant', () => {
  it('sets the company, clears the user, and runs as pospay_app', async () => {
    expect(await database.withTenant(COMPANY_A, readContext)).toEqual({
      company: COMPANY_A,
      user: null,
      role: 'pospay_app',
    });
  });

  it('sets the acting user when one is given', async () => {
    const context = await database.withTenant(COMPANY_A, readContext, { userId: USER_1 });
    expect(context.user).toBe(USER_1);
  });

  it('rejects a malformed id before touching the database', async () => {
    await expect(database.withTenant('not-a-uuid', readContext)).rejects.toThrow(TypeError);
  });
});

describe('ping', () => {
  it('resolves when the database answers — no tenant context needed', async () => {
    await expect(database.ping()).resolves.toBeUndefined();
  });

  it('rejects when the database cannot be reached', async () => {
    const unreachable = createDatabase({
      url: 'postgres://pospay_app:unused@127.0.0.1:1/none',
      ids: { newId: () => NEW_COMPANY },
    });
    try {
      await expect(unreachable.ping()).rejects.toThrow();
    } finally {
      await unreachable.close();
    }
  });
});

describe('withUser', () => {
  it('sets only the user', async () => {
    expect(await database.withUser(USER_1, readContext)).toMatchObject({
      company: null,
      user: USER_1,
    });
  });
});

describe('withNewTenant', () => {
  it('generates the company id itself and passes it to fn', async () => {
    const result = await database.withNewTenant(USER_1, async (tx, companyId) => ({
      companyId,
      context: await readContext(tx),
    }));
    expect(result.companyId).toBe(NEW_COMPANY);
    expect(result.context).toMatchObject({ company: NEW_COMPANY, user: USER_1 });
  });
});

describe('refuses a role that bypasses RLS', () => {
  it('rejects every wrapper when DATABASE_URL points at the superuser owner', async () => {
    const misconfigured = createDatabase({
      url: testDb.ownerUrl,
      ids: { newId: () => NEW_COMPANY },
    });
    let ran = false;
    const probe = async (): Promise<void> => {
      ran = true;
    };
    try {
      await expect(misconfigured.withTenant(COMPANY_A, probe)).rejects.toThrow(/bypasses RLS/);
      await expect(misconfigured.withUser(USER_1, probe)).rejects.toThrow(/bypasses RLS/);
      await expect(misconfigured.withNewTenant(USER_1, probe)).rejects.toThrow(/bypasses RLS/);
      expect(ran).toBe(false);
    } finally {
      await misconfigured.close();
    }
  });
});

describe('settings are transaction-local on a pooled connection', () => {
  it('does not leak a company into the next transaction on the same connection', async () => {
    await database.withTenant(COMPANY_A, readContext, { userId: USER_1 });
    expect(await database.withUser(USER_1, readContext)).toMatchObject({ company: null });
  });

  it('does not leak a user into the next tenant transaction', async () => {
    await database.withUser(USER_1, readContext);
    expect(await database.withTenant(COMPANY_A, readContext)).toMatchObject({ user: null });
  });

  it('rolls back and still clears the settings when fn throws', async () => {
    await expect(
      database.withTenant(COMPANY_A, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await database.withUser(USER_1, readContext)).toMatchObject({ company: null });
  });
});

describe('withTenant timeoutMs', () => {
  it('cancels a statement that runs too long, and the pool of one is usable right after', async () => {
    const started = Date.now();
    await expect(
      database.withTenant(COMPANY_A, (tx) => tx.execute(sql`SELECT pg_sleep(5)`), {
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ cause: { code: '57014' } });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await database.withTenant(COMPANY_A, readContext)).toMatchObject({ company: COMPANY_A });
  });

  it('a transaction left idle past the deadline never commits', async () => {
    await expect(
      database.withTenant(
        COMPANY_A,
        async (tx) => {
          await tx.execute(sql`SELECT 1`);
          await new Promise((done) => setTimeout(done, 600));
          await tx.execute(sql`SELECT 1`);
        },
        { timeoutMs: 200 },
      ),
    ).rejects.toThrow();
    expect(await database.withTenant(COMPANY_A, readContext)).toMatchObject({ company: COMPANY_A });
  });

  it('rejects a timeout that is not a whole number of milliseconds', async () => {
    await expect(database.withTenant(COMPANY_A, readContext, { timeoutMs: 0 })).rejects.toThrow(
      TypeError,
    );
  });
});
