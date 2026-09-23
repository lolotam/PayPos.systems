import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// Privilege inventory (plan v4 T5, closes #16). This list is reviewed: a grant a migration adds that
// is not written here fails the suite, so a broad grant cannot authorise itself.
const ALLOWED_TABLE_GRANTS: Record<string, string[]> = {
  pospay_app: [
    'branches:DELETE',
    'branches:INSERT',
    'branches:SELECT',
    'branches:UPDATE',
    'businesses:DELETE',
    'businesses:INSERT',
    'businesses:SELECT',
    'businesses:UPDATE',
    'companies:INSERT',
    'companies:SELECT',
    'companies:UPDATE',
    'company_feature_overrides:SELECT',
    'plans:SELECT',
  ],
  // Global identity tables (ADR-0003 §2.1) arrive in T9a; until then pospay_auth holds no table grant.
  pospay_auth: [],
};
const TENANT_TABLES = ['companies', 'businesses', 'branches', 'company_feature_overrides'];
const APP_ROLES = ['pospay_app', 'pospay_auth'];

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

// Reads the ACLs themselves: information_schema.role_table_grants leaves out grants to PUBLIC, and
// a PUBLIC TRUNCATE would bypass RLS on every tenant's rows.
const aclGrants = (grantee: string) => {
  // 0 is PUBLIC in an ACL. A role is looked up by name and must exist — an unknown name is an error,
  // never silently treated as PUBLIC.
  const who = grantee === 'PUBLIC' ? owner`0::oid` : owner`${grantee}::regrole::oid`;
  return owner<{ grant: string }[]>`
    SELECT c.relname || ':' || a.privilege_type AS grant
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND a.grantee = ${who}
    ORDER BY 1`;
};

describe('direct privileges match the reviewed allowlist', () => {
  it.each(APP_ROLES)('%s holds exactly the listed table and sequence grants', async (role) => {
    expect((await aclGrants(role)).map((r) => r.grant)).toEqual(ALLOWED_TABLE_GRANTS[role]);
  });

  it('PUBLIC holds no privilege on any table, view or sequence, and no column has its own ACL', async () => {
    expect(await aclGrants('PUBLIC')).toEqual([]);
    const [row] = await owner`
      SELECT count(*)::int AS column_acls FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL`;
    expect(row).toEqual({ column_acls: 0 });
  });

  it.each(APP_ROLES)(
    '%s may use the public schema but not create in it or in the database',
    async (role) => {
      const [row] = await owner`
      SELECT has_schema_privilege(${role}, 'public', 'USAGE') AS usage,
             has_schema_privilege(${role}, 'public', 'CREATE') AS create_in_schema,
             has_database_privilege(${role}, current_database(), 'CREATE') AS create_in_db`;
      expect(row).toEqual({ usage: true, create_in_schema: false, create_in_db: false });
    },
  );
});

// Effective privileges — what the role can actually do, including anything inherited through a role
// membership. Compared with the same reviewed allowlist, so an inherited grant fails the suite too.
const TABLE_PRIVILEGES = [
  'DELETE',
  'INSERT',
  'REFERENCES',
  'SELECT',
  'TRIGGER',
  'TRUNCATE',
  'UPDATE',
];
const SEQUENCE_PRIVILEGES = ['SELECT', 'UPDATE', 'USAGE'];
const effectiveGrants = async (role: string): Promise<string[]> => {
  const rows = await owner<{ grant: string }[]>`
    SELECT c.relname || ':' || p AS grant
    FROM pg_class c CROSS JOIN unnest(${TABLE_PRIVILEGES}::text[]) AS p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_table_privilege(${role}, c.oid, p)
    UNION ALL
    SELECT c.relname || ':' || p FROM pg_class c CROSS JOIN unnest(${SEQUENCE_PRIVILEGES}::text[]) AS p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
      AND has_sequence_privilege(${role}, c.oid, p)
    ORDER BY 1`;
  return rows.map((r) => r.grant);
};

describe('effective privileges match the reviewed allowlist', () => {
  it.each(APP_ROLES)('%s can do exactly what the allowlist says, no more', async (role) => {
    expect(await effectiveGrants(role)).toEqual(ALLOWED_TABLE_GRANTS[role]);
  });

  it('an inherited grant is caught — DELETE on plans through a helper role', async () => {
    await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`CREATE ROLE pospay_test_helper NOLOGIN`;
        await owner`GRANT DELETE ON plans TO pospay_test_helper`;
        await owner`GRANT pospay_test_helper TO pospay_app WITH INHERIT TRUE`;
        expect(await effectiveGrants('pospay_app')).toContain('plans:DELETE');
      } finally {
        await owner`REVOKE ALL ON plans FROM pospay_test_helper`;
        await owner`DROP ROLE IF EXISTS pospay_test_helper`;
      }
    });
  });
});

describe('effective access', () => {
  it('pospay_auth reaches no tenant table and no reference table', async () => {
    const rows = await owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_auth', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`;
    expect(rows).toEqual([]);
  });

  it('pospay_app cannot TRUNCATE, REFERENCE or TRIGGER any table — each would bypass or outlive RLS', async () => {
    const rows = await owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_app', t, 'TRUNCATE, REFERENCES, TRIGGER')`;
    expect(rows).toEqual([]);
  });

  it('no application role owns a table', async () => {
    const rows = await owner`
      SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
      WHERE c.relnamespace = 'public'::regnamespace AND r.rolname = ANY(${APP_ROLES})`;
    expect(rows).toHaveLength(0);
  });

  it('every tenant table has row-level security enabled and forced', async () => {
    const rows = await owner`
      SELECT relname FROM pg_class
      WHERE relname = ANY(${TENANT_TABLES}) AND relrowsecurity AND relforcerowsecurity ORDER BY 1`;
    expect(rows.map((r) => r['relname'])).toEqual([...TENANT_TABLES].sort());
  });
});

describe('function inventory', () => {
  it('the only functions are the two context helpers, and neither is SECURITY DEFINER', async () => {
    const rows = await owner`
      SELECT proname, prosecdef FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace ORDER BY proname`;
    expect(Array.from(rows)).toEqual([
      { proname: 'app_company_id', prosecdef: false },
      { proname: 'app_user_id', prosecdef: false },
    ]);
  });
});
