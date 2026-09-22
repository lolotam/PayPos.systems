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
  it('pospay_app and pospay_auth are restricted login roles', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<RoleRow[]>`
      SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolcanlogin
      FROM pg_roles WHERE rolname IN ('pospay_app', 'pospay_auth') ORDER BY rolname`,
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
    ]);
  });

  it('are members of no other role, so they cannot SET ROLE to a privileged one', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner`
      SELECT m.member FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname IN ('pospay_app', 'pospay_auth')`,
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
        await migrateDatabase(testDb.ownerUrl, { app: env.appPassword, auth: env.authPassword });
        const rows = await owner`
          SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
          WHERE r.rolname IN ('pospay_app', 'pospay_auth')`;
        expect(rows).toHaveLength(0);
      } finally {
        await owner`REVOKE pg_read_all_data FROM pospay_app CASCADE`;
      }
    });
  });

  it('migrating again is a no-op that keeps the roles restricted', async () => {
    const env = readPgTestEnv();
    await migrateDatabase(testDb.ownerUrl, { app: env.appPassword, auth: env.authPassword });
    const [row] = await owner<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'pospay_app'`;
    expect(row).toEqual({ rolbypassrls: false });
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
