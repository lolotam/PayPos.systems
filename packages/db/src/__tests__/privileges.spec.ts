import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('direct privileges match the reviewed allowlist', () => {
  it.each(APP_ROLES)('%s holds exactly the listed table grants', async (role) => {
    const rows = await owner<{ grant: string }[]>`
      SELECT table_name || ':' || privilege_type AS grant FROM information_schema.role_table_grants
      WHERE grantee = ${role} AND table_schema = 'public' ORDER BY 1`;
    expect(rows.map((r) => r.grant)).toEqual(ALLOWED_TABLE_GRANTS[role]);
  });

  it('no table, column or sequence privilege is granted to PUBLIC or held per column', async () => {
    const [counts] = await owner`
      SELECT (SELECT count(*) FROM information_schema.role_table_grants
              WHERE grantee = 'PUBLIC' AND table_schema = 'public')::int AS public_tables,
             (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
              WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL)::int AS column_acls,
             (SELECT count(*) FROM information_schema.role_usage_grants
              WHERE object_schema = 'public' AND object_type = 'SEQUENCE')::int AS sequence_grants`;
    expect(counts).toEqual({ public_tables: 0, column_acls: 0, sequence_grants: 0 });
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

describe('effective access', () => {
  it('pospay_auth reaches no tenant table and no reference table', async () => {
    const rows = await owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_auth', t, 'SELECT, INSERT, UPDATE, DELETE')`;
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
