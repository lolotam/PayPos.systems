import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '../access-catalog.ts';
import { createDatabase, type Database } from '../index.ts';

// T9a-2 negative suite (ADR-0003 §2.2, §2.3), run as pospay_app through the real wrappers; the owner only seeds.
const { A, B } = TENANT;
const UA = '01920000-0000-7000-8000-0000000000f2';
const UB = '01920000-0000-7000-8000-0000000000f3';
const MA = '01920000-0000-7000-8000-0000000000d1';
const MB = '01920000-0000-7000-8000-0000000000d2';
const RA = '01920000-0000-7000-8000-0000000000e1';
const RB = '01920000-0000-7000-8000-0000000000e2';
const NEW_ID = '01920000-0000-7000-8000-0000000000d9';
const PERM = 'read:memberships:company';

let testDb: TestDatabase;
let db: Database;

const refused = async (work: Promise<unknown>, expected: RegExp): Promise<void> => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected the statement to be refused').toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(String(cause instanceof Error ? cause.message : (error as Error).message)).toMatch(
    expected,
  );
};

const asTenant = (companyId: string, query: SQL) =>
  db.withTenant(companyId, async (tx) =>
    Array.from(await tx.execute<Record<string, unknown>>(query)),
  );
const asUser = (userId: string, query: SQL) =>
  db.withUser(userId, async (tx) => Array.from(await tx.execute<Record<string, unknown>>(query)));

async function seed(ownerUrl: string): Promise<void> {
  await seedTwoTenants(ownerUrl);
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const [user, email] of [
      [UA, 'a@example.test'],
      [UB, 'b@example.test'],
    ] as const) {
      await owner`INSERT INTO "user" (id, name, email) VALUES (${user}, 'U', ${email})`;
    }
    for (const [membership, company, user, role] of [
      [MA, A.company, UA, RA],
      [MB, B.company, UB, RB],
    ] as const) {
      await owner`INSERT INTO roles (id, company_id, code, name_en) VALUES (${role}, ${company}, 'custom', 'Custom')`;
      await owner`INSERT INTO role_permissions (role_id, role_owner_key, company_id, permission_code)
                  VALUES (${role}, ${company}, ${company}, ${PERM})`;
      await owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
                  VALUES (${company}, ${membership}, ${user}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${company})`;
      await owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
                    scope_type, scope_id, reason, granted_by)
                  VALUES (${company}, ${membership}, ${membership}, ${PERM}, 'DENY', 'COMPANY', ${company}, 'r', ${user})`;
    }
  } finally {
    await owner.end();
  }
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seed(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => NEW_ID } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('the bridge: a user sees their own rows, a company sees its own (§2.2)', () => {
  it('withUser lists only my memberships and overrides, in every company', async () => {
    expect(await asUser(UA, sql`SELECT id FROM memberships`)).toEqual([{ id: MA }]);
    expect(await asUser(UA, sql`SELECT id FROM permission_overrides`)).toEqual([{ id: MA }]);
  });

  it("withTenant(A) lists A's memberships and overrides, never B's", async () => {
    expect(await asTenant(A.company, sql`SELECT id FROM memberships`)).toEqual([{ id: MA }]);
    expect(await asTenant(A.company, sql`SELECT id FROM permission_overrides`)).toEqual([
      { id: MA },
    ]);
  });

  it('A sees the system roles and its own, not B’s custom role or its permissions', async () => {
    const roles = await asTenant(A.company, sql`SELECT id FROM roles`);
    expect(roles.map((r) => r['id']).sort()).toEqual([...SYSTEM_ROLES.map((r) => r.id), RA].sort());
    const perms = await asTenant(A.company, sql`SELECT DISTINCT role_id FROM role_permissions`);
    expect(perms.map((r) => r['role_id']).sort()).toEqual([OWNER_ROLE_ID, RA].sort());
  });
});

describe('writes stay inside the current company', () => {
  it('a membership for B is refused under withTenant(A); B’s rows cannot be changed or deleted', async () => {
    await refused(
      asTenant(
        A.company,
        sql`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
        VALUES (${B.company}, ${NEW_ID}, ${UA}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${B.company})`,
      ),
      /row-level security/,
    );
    expect(
      await asTenant(
        A.company,
        sql`UPDATE memberships SET ends_at = now() WHERE id = ${MB} RETURNING id`,
      ),
    ).toEqual([]);
    expect(
      await asTenant(
        A.company,
        sql`DELETE FROM permission_overrides WHERE id = ${MB} RETURNING id`,
      ),
    ).toEqual([]);
  });

  it('withUser can read my own membership but not change it — writes are company-scoped', async () => {
    expect(
      await asUser(UA, sql`UPDATE memberships SET ends_at = now() WHERE id = ${MA} RETURNING id`),
    ).toEqual([]);
    await refused(
      asUser(
        UA,
        sql`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
        VALUES (${A.company}, ${NEW_ID}, ${UA}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${A.company})`,
      ),
      /row-level security/,
    );
  });
});

describe('system roles cannot be changed, re-homed or extended by a tenant (§2.3)', () => {
  it('UPDATE, re-home and DELETE of a system role touch no row', async () => {
    const owner = sql`id = ${OWNER_ROLE_ID}`;
    expect(
      await asTenant(A.company, sql`UPDATE roles SET name_en = 'Mine' WHERE ${owner} RETURNING id`),
    ).toEqual([]);
    expect(
      await asTenant(
        A.company,
        sql`UPDATE roles SET company_id = ${A.company} WHERE ${owner} RETURNING id`,
      ),
    ).toEqual([]);
    expect(await asTenant(A.company, sql`DELETE FROM roles WHERE ${owner} RETURNING id`)).toEqual(
      [],
    );
  });

  it('a tenant cannot create a system role or add a permission to one', async () => {
    await refused(
      asTenant(
        A.company,
        sql`INSERT INTO roles (id, company_id, code, name_en) VALUES (${NEW_ID}, NULL, 'x', 'X')`,
      ),
      /row-level security/,
    );
    await refused(
      asTenant(
        A.company,
        sql`INSERT INTO role_permissions (role_id, role_owner_key, company_id, permission_code)
        VALUES (${OWNER_ROLE_ID}, 'global', ${A.company}, ${PERM})`,
      ),
      /role_permissions_owner/,
    );
  });
});

describe('memberships reference only roles and scopes of their own company', () => {
  const insert = (role: string, ownerKey: string, scopeType: string, scopeId: string) =>
    asTenant(
      A.company,
      sql`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
      VALUES (${A.company}, ${NEW_ID}, ${UA}, ${role}, ${ownerKey}, ${scopeType}, ${scopeId})`,
    );

  it("another company's custom role is refused, whichever owner key is claimed", async () => {
    await refused(insert(RB, B.company, 'COMPANY', A.company), /memberships_role_owner/);
    await refused(insert(RB, A.company, 'COMPANY', A.company), /memberships_role_fk/);
  });

  it("another company's business or branch, or a COMPANY scope naming another id, is refused", async () => {
    await refused(
      insert(OWNER_ROLE_ID, 'global', 'BUSINESS', B.business),
      /memberships_scope_business_fk/,
    );
    await refused(
      insert(OWNER_ROLE_ID, 'global', 'BRANCH', B.branch),
      /memberships_scope_branch_fk/,
    );
    await refused(
      insert(OWNER_ROLE_ID, 'global', 'COMPANY', B.company),
      /memberships_company_scope/,
    );
  });
});

describe('permissions: reference data the app reads and never writes', () => {
  it('pospay_app reads the catalogue but cannot add to it', async () => {
    expect(
      await asTenant(A.company, sql`SELECT code FROM permissions WHERE code = ${PERM}`),
    ).toEqual([{ code: PERM }]);
    await refused(
      asTenant(A.company, sql`INSERT INTO permissions (code) VALUES ('x:y:company')`),
      /permission denied/,
    );
  });
});
