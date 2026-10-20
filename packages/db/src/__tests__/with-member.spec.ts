import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { OWNER_ROLE_ID } from '../access-catalog.ts';
import { createDatabase } from '../index.ts';
import { createTenantWrappers, type TenantWrappers, type Tx } from '../with-tenant.ts';

const { A, B } = TENANT;
const MEMBER = '01920000-0000-7000-8000-0000000000e1';
const EXPIRED = '01920000-0000-7000-8000-0000000000e2';
const FUTURE = '01920000-0000-7000-8000-0000000000e3';
const OTHER = '01920000-0000-7000-8000-0000000000e4';
const dialect = new PgDialect();
const seen: { company: string | null | undefined } = { company: undefined };

let testDb: TestDatabase;
let owner: postgres.Sql;
let client: postgres.Sql;
let wrappers: TenantWrappers;

function watchMembership(tx: Tx): Tx {
  return new Proxy(tx, {
    get: (target, property, receiver) =>
      property === 'execute'
        ? async (query: SQL) => {
            if (/\bmemberships\b/.test(dialect.sqlToQuery(query).sql)) {
              const [row] = await target.execute<{ company_guc: string | null }>(
                sql`SELECT current_setting('app.company_id', true) AS company_guc`,
              );
              seen.company = row?.company_guc ?? null;
            }
            return target.execute(query);
          }
        : Reflect.get(target, property, receiver),
  }) as Tx;
}

function watchingDatabase(connection: postgres.Sql): PostgresJsDatabase {
  const base = drizzle(connection);
  return new Proxy(base, {
    get: (target, property, receiver) =>
      property === 'transaction'
        ? (work: (tx: Tx) => Promise<unknown>) =>
            target.transaction(async (tx) => work(watchMembership(tx)))
        : Reflect.get(target, property, receiver),
  }) as unknown as PostgresJsDatabase;
}

async function insertUser(id: string, email: string): Promise<void> {
  await owner`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Member', ${email})`;
}

async function insertMembership(
  companyId: string,
  id: string,
  userId: string,
  startsAt?: string,
  endsAt?: string,
): Promise<void> {
  if (startsAt === undefined) {
    await owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
                VALUES (${companyId}, ${id}, ${userId}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${companyId})`;
    return;
  }
  await owner`INSERT INTO memberships
                (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at)
              VALUES (${companyId}, ${id}, ${userId}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${companyId},
                      ${startsAt}::timestamptz, ${endsAt ?? null}::timestamptz)`;
}

async function refused(userId: string, companyId: string): Promise<void> {
  let ran = false;
  await expect(
    wrappers.withMember(userId, companyId, async () => {
      ran = true;
      return true;
    }),
  ).resolves.toBeNull();
  expect(ran).toBe(false);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await insertUser(MEMBER, 'member@example.test');
  await insertUser(EXPIRED, 'expired@example.test');
  await insertUser(FUTURE, 'future@example.test');
  await insertUser(OTHER, 'other@example.test');
  await insertMembership(A.company, '01920000-0000-7000-8000-0000000000d1', MEMBER);
  await insertMembership(
    A.company,
    '01920000-0000-7000-8000-0000000000d2',
    EXPIRED,
    '2000-01-01T00:00:00Z',
    '2001-01-01T00:00:00Z',
  );
  await insertMembership(
    A.company,
    '01920000-0000-7000-8000-0000000000d3',
    FUTURE,
    '2100-01-01T00:00:00Z',
  );
  await insertMembership(B.company, '01920000-0000-7000-8000-0000000000d4', OTHER);
  client = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  wrappers = createTenantWrappers(watchingDatabase(client), {
    newId: () => '01920000-0000-7000-8000-0000000000c1',
  });
});

beforeEach(() => {
  seen.company = undefined;
});

afterAll(async () => {
  await client.end({ timeout: 5 });
  await owner.end({ timeout: 5 });
  await testDb.drop();
});

describe('withMember', () => {
  it('does not enter the company when the user has no membership', async () => {
    await refused(USER, A.company);
    expect(seen.company).toBe('');
  });

  it('enters only after the membership proof, with the company set', async () => {
    const company = await wrappers.withMember(MEMBER, A.company, async (tx) => {
      const [row] = await tx.execute<{ company: string }>(
        sql`SELECT current_setting('app.company_id', true) AS company`,
      );
      return row?.company;
    });
    expect(company).toBe(A.company);
    expect(seen.company).toBe('');
  });

  it.each([
    ['expired', EXPIRED],
    ['future', FUTURE],
  ] as const)('refuses a %s membership', async (_label, userId) => {
    await refused(userId, A.company);
  });

  it('refuses company A when the only membership is in company B', async () => {
    await expect(wrappers.withMember(OTHER, B.company, async () => true)).resolves.toBe(true);
    await refused(OTHER, A.company);
  });

  it('rejects a malformed id before the membership query', async () => {
    let ran = false;
    const probe = async (): Promise<boolean> => {
      ran = true;
      return true;
    };
    await expect(wrappers.withMember('not-a-uuid', A.company, probe)).rejects.toThrow(TypeError);
    await expect(wrappers.withMember(MEMBER, 'not-a-uuid', probe)).rejects.toThrow(TypeError);
    expect(ran).toBe(false);
    expect(seen.company).toBeUndefined();
  });

  it('rejects a role that bypasses RLS before the callback', async () => {
    const misconfigured = createDatabase({
      url: testDb.ownerUrl,
      ids: { newId: () => '01920000-0000-7000-8000-0000000000c1' },
    });
    let ran = false;
    try {
      await expect(
        misconfigured.withMember(MEMBER, A.company, async () => {
          ran = true;
          return true;
        }),
      ).rejects.toThrow(/bypasses RLS/);
      expect(ran).toBe(false);
    } finally {
      await misconfigured.close();
    }
  });
});
