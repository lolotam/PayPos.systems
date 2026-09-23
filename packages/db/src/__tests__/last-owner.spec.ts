import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '../access-catalog.ts';
import { createDatabase, type Database } from '../index.ts';

// Last-owner protection (ADR-0003 §5.3, plan T9a-4), run as pospay_app inside withTenant: whatever a transaction
// does to owner memberships, it cannot commit a company that had an owner and now has none.
const { A } = TENANT;
const FIRST = '01920000-0000-7000-8000-0000000000c1';
const SECOND = '01920000-0000-7000-8000-0000000000c2';
const U1 = '01920000-0000-7000-8000-0000000000f4';
const U2 = '01920000-0000-7000-8000-0000000000f5';
const VIEWER = SYSTEM_ROLES.find((role) => role.code === 'viewer')?.id ?? '';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  for (const [user, email] of [
    [U1, 'u1@example.test'],
    [U2, 'u2@example.test'],
  ] as const) {
    await owner`INSERT INTO "user" (id, name, email) VALUES (${user}, 'U', ${email})`;
  }
  await owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
              VALUES (${A.company}, ${FIRST}, ${U1}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${A.company})`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => SECOND } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const inA = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, async (tx) => {
    await tx.execute(query);
  });
const refusedAtCommit = /a company must keep at least one owner/;

describe('the last owner cannot leave', () => {
  it('deleting, ending or demoting the only owner is refused at commit', async () => {
    await expect(inA(sql`DELETE FROM memberships WHERE id = ${FIRST}`)).rejects.toThrow(
      refusedAtCommit,
    );
    await expect(
      inA(sql`UPDATE memberships SET ends_at = now() + interval '1 day' WHERE id = ${FIRST}`),
    ).rejects.toThrow(refusedAtCommit);
    await expect(
      inA(sql`UPDATE memberships SET role_id = ${VIEWER} WHERE id = ${FIRST}`),
    ).rejects.toThrow(refusedAtCommit);
    expect(await owner`SELECT ends_at, role_id FROM memberships WHERE id = ${FIRST}`).toEqual([
      { ends_at: null, role_id: OWNER_ROLE_ID },
    ]);
  });

  it('with a second owner added in the same transaction, the first may leave', async () => {
    await db.withTenant(A.company, async (tx) => {
      await tx.execute(sql`DELETE FROM memberships WHERE id = ${FIRST}`);
      await tx.execute(sql`
        INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
        VALUES (${A.company}, ${SECOND}, ${U2}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${A.company})`);
    });
    expect(await owner`SELECT user_id FROM memberships WHERE company_id = ${A.company}`).toEqual([
      { user_id: U2 },
    ]);
  });
});
