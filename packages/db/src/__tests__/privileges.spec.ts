import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// Privilege inventory (plan v4 T5, closes #16). This list is reviewed: a grant a migration adds that
// is not written here fails the suite, so a broad grant cannot authorise itself.
const ALLOWED_TABLE_GRANTS: Record<string, string[]> = {
  pospay_app: [
    'audit_log:INSERT',
    'audit_log:SELECT',
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
    'consumed_events:INSERT',
    'consumed_events:SELECT',
    'idempotency_keys:INSERT',
    'idempotency_keys:SELECT',
    'idempotency_keys:UPDATE',
    'outbox:INSERT',
    'plans:SELECT',
  ],
  // Global identity tables (ADR-0003 §2.1) arrive in T9a; until then pospay_auth holds no table grant.
  pospay_auth: [],
  // Cross-tenant reader of outbox only (ADR-0003 §3); its UPDATE is column-level, listed in OUTBOX_COLUMN_GRANTS.
  pospay_dispatcher: ['outbox:SELECT'],
};
// The dispatcher may change delivery metadata only — id, company_id and payload stay immutable to it.
const OUTBOX_COLUMN_GRANTS = [
  'outbox.attempts:pospay_dispatcher:UPDATE',
  'outbox.last_error:pospay_dispatcher:UPDATE',
  'outbox.next_attempt_at:pospay_dispatcher:UPDATE',
  'outbox.parked_at:pospay_dispatcher:UPDATE',
  'outbox.published_at:pospay_dispatcher:UPDATE',
];
const TENANT_TABLES = [
  'companies',
  'businesses',
  'branches',
  'company_feature_overrides',
  'outbox',
  'audit_log',
  'idempotency_keys',
  'consumed_events',
];
const APP_ROLES = ['pospay_app', 'pospay_auth', 'pospay_dispatcher'];

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

  it('PUBLIC holds no privilege on any table, view or sequence', async () => {
    expect(await aclGrants('PUBLIC')).toEqual([]);
  });

  it('the only column-level grants are the delivery metadata of outbox, to the dispatcher', async () => {
    const rows = await owner<{ grant: string }[]>`
      SELECT c.relname || '.' || a.attname || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type AS grant
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
      WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL
      ORDER BY 1`;
    expect(rows.map((r) => r.grant)).toEqual(OUTBOX_COLUMN_GRANTS);
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
    // Shared lock: another spec file may be holding a temporary membership under the exclusive one.
    expect(await withClusterRoleLock('shared', () => effectiveGrants(role))).toEqual(
      ALLOWED_TABLE_GRANTS[role],
    );
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

// A role the application can SET ROLE to is a way around every check above, even without inheritance.
const settableRoles = async (role: string): Promise<string[]> => {
  const rows = await owner<{ name: string }[]>`
    SELECT rolname AS name FROM pg_roles
    WHERE rolname <> ${role} AND pg_has_role(${role}, oid, 'SET') ORDER BY 1`;
  return rows.map((r) => r.name);
};

describe('no application role can switch to another role', () => {
  it.each(APP_ROLES)('%s can SET ROLE to no other role, directly or indirectly', async (role) => {
    expect(await withClusterRoleLock('shared', () => settableRoles(role))).toEqual([]);
  });

  it('a non-inheriting membership is caught — INHERIT FALSE, SET TRUE', async () => {
    await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`CREATE ROLE pospay_test_settable NOLOGIN`;
        await owner`GRANT pospay_test_settable TO pospay_app WITH INHERIT FALSE, SET TRUE`;
        expect(await settableRoles('pospay_app')).toEqual(['pospay_test_settable']);
      } finally {
        await owner`DROP ROLE IF EXISTS pospay_test_settable`;
      }
    });
  });
});

describe('effective access', () => {
  it('pospay_auth reaches no tenant table and no reference table', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_auth', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it('pospay_app cannot TRUNCATE, REFERENCE or TRIGGER any table — each would bypass or outlive RLS', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_app', t, 'TRUNCATE, REFERENCES, TRIGGER')`,
    );
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
  it('lists every function; the one SECURITY DEFINER pins its search_path', async () => {
    const rows = await owner`
      SELECT proname, prosecdef, proconfig FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace ORDER BY proname`;
    expect(Array.from(rows)).toEqual([
      { proname: 'app_company_id', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
      { proname: 'app_user_id', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
      {
        proname: 'idempotency_keys_require_response',
        prosecdef: false,
        proconfig: ['search_path=public, pg_temp'],
      },
      {
        proname: 'sweep_expired_idempotency_keys',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog, pg_temp'],
      },
    ]);
  });

  it('only pospay_dispatcher may execute the SECURITY DEFINER sweep', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ role: string }[]>`
      SELECT r AS role FROM unnest(${APP_ROLES}::text[]) AS r
      WHERE has_function_privilege(r, 'sweep_expired_idempotency_keys(integer)', 'EXECUTE')`,
    );
    expect(rows.map((r) => r.role)).toEqual(['pospay_dispatcher']);
  });
});
