import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readPgTestEnv } from '../../test/pg-env.ts';
import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { migrateDatabase } from '../migrations.ts';

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolcanlogin: boolean;
}

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

describe('application roles (ADR-0003 §3)', () => {
  it('pospay_app, pospay_auth and pospay_dispatcher are restricted login roles', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<RoleRow[]>`
      SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolcanlogin
      FROM pg_roles WHERE rolname IN ('pospay_app', 'pospay_auth', 'pospay_dispatcher') ORDER BY rolname`,
    );
    const restricted = {
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolcanlogin: true,
    };
    expect(rows).toEqual([
      { rolname: 'pospay_app', ...restricted },
      { rolname: 'pospay_auth', ...restricted },
      { rolname: 'pospay_dispatcher', ...restricted },
    ]);
  });

  it('are members of no other role, so they cannot SET ROLE to a privileged one', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner`
      SELECT m.member FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname IN ('pospay_app', 'pospay_auth', 'pospay_dispatcher')`,
    );
    expect(rows).toHaveLength(0);
  });

  it('pospay_app cannot create objects in the public schema', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await expect(app`CREATE TABLE sneaky (id int)`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});

describe('bootstrap re-run (pnpm db:migrate on a persistent cluster)', () => {
  it('migrating again revokes hand-granted memberships, even a grant chain', async () => {
    const env = readPgTestEnv();
    await withClusterRoleLock('exclusive', async () => {
      try {
        // pospay_app gets a role WITH ADMIN OPTION and passes it on to pospay_auth: without
        // CASCADE, revoking the first grant fails because the second depends on it.
        await owner`GRANT pg_read_all_data TO pospay_app WITH ADMIN OPTION`;
        await owner.begin(async (tx) => {
          await tx`SET LOCAL ROLE pospay_app`;
          await tx`GRANT pg_read_all_data TO pospay_auth`;
        });
        await migrateDatabase(testDb.ownerUrl, {
          app: env.appPassword,
          auth: env.authPassword,
          dispatcher: env.dispatcherPassword,
        });
        const rows = await owner`
          SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
          WHERE r.rolname IN ('pospay_app', 'pospay_auth', 'pospay_dispatcher')`;
        expect(rows).toHaveLength(0);
      } finally {
        await owner`REVOKE pg_read_all_data FROM pospay_app CASCADE`;
      }
    });
  });

  it('migrating again clears a stale connection limit and an expired password', async () => {
    const env = readPgTestEnv();
    const rows = await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`ALTER ROLE pospay_auth CONNECTION LIMIT 0 VALID UNTIL '2000-01-01'`;
        await migrateDatabase(testDb.ownerUrl, {
          app: env.appPassword,
          auth: env.authPassword,
          dispatcher: env.dispatcherPassword,
        });
        return await owner`
          SELECT rolconnlimit, rolvaliduntil = 'infinity' AS forever
          FROM pg_roles WHERE rolname = 'pospay_auth'`;
      } finally {
        await owner`ALTER ROLE pospay_auth CONNECTION LIMIT -1 VALID UNTIL 'infinity'`;
      }
    });
    expect(rows).toEqual([{ rolconnlimit: -1, forever: true }]);
  });

  it('migrating again is a no-op that keeps the roles restricted', async () => {
    const env = readPgTestEnv();
    const [row] = await withClusterRoleLock('exclusive', async () => {
      await migrateDatabase(testDb.ownerUrl, {
        app: env.appPassword,
        auth: env.authPassword,
        dispatcher: env.dispatcherPassword,
      });
      return owner<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = 'pospay_app'`;
    });
    expect(row).toEqual({ rolbypassrls: false });
  });
});

describe('bootstrap re-run for the approval reader role', () => {
  // ترتيب bootstrap ثم migration هو الافتراضي لكل قاعدة جديدة (يغطيه اختبار الدور في statement-pending-count-role.spec.ts)؛
  // هنا الترتيب المعاكس: دور أُفسد بعد أن طُبّقت الهجرة، ثم يعاد الـ bootstrap فيصلح الدور ولا يمسّ دالته ولا منحه ولا سياساته.
  it('migrating again restores the approval reader role and leaves its function, grants and policies in place', async () => {
    const env = readPgTestEnv();
    const row = await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`CREATE ROLE pospay_test_reader_member NOLOGIN`;
        await owner`ALTER ROLE pospay_approval_reader LOGIN CREATEDB`;
        await owner`GRANT pg_read_all_data TO pospay_approval_reader WITH ADMIN OPTION`;
        await owner`GRANT pospay_approval_reader TO pospay_test_reader_member`;
        await migrateDatabase(testDb.ownerUrl, {
          app: env.appPassword,
          auth: env.authPassword,
          dispatcher: env.dispatcherPassword,
        });
        return (
          await owner`SELECT r.rolcanlogin, r.rolcreatedb, r.rolsuper, r.rolbypassrls, r.rolinherit,
          (SELECT count(*) FROM pg_auth_members m WHERE r.oid IN (m.roleid, m.member))::int AS links,
          pg_get_userbyid((SELECT proowner FROM pg_proc WHERE proname = 'statement_pending_commission_events')) AS fn_owner,
          has_function_privilege('pospay_app', 'public.statement_pending_commission_events(timestamptz)', 'EXECUTE') AS app_executes,
          has_column_privilege(r.oid, 'public.outbox', 'event_type', 'SELECT') AS reads_outbox,
          (SELECT count(*) FROM pg_policies WHERE policyname LIKE '%approval_reader%')::int AS policies
          FROM pg_roles r WHERE r.rolname = 'pospay_approval_reader'`
        )[0];
      } finally {
        await owner`DROP ROLE IF EXISTS pospay_test_reader_member`;
        await owner`ALTER ROLE pospay_approval_reader NOLOGIN NOCREATEDB`;
        await owner`REVOKE pg_read_all_data FROM pospay_approval_reader CASCADE`;
      }
    });
    expect(row).toEqual({
      rolcanlogin: false,
      rolcreatedb: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      links: 0,
      fn_owner: 'pospay_approval_reader',
      app_executes: true,
      reads_outbox: true,
      policies: 2,
    });
  });
});

describe('context helpers (migration 0000)', () => {
  it('read an unset or empty setting as NULL instead of failing the uuid cast', async () => {
    const rows = await owner.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', '', true)`;
      return tx`SELECT app_company_id() AS company, app_user_id() AS "user"`;
    });
    expect(rows[0]).toEqual({ company: null, user: null });
  });
});
