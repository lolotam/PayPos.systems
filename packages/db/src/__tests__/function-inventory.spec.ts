import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FUNCTION_INVENTORY } from '../../test/function-inventory.ts';
import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// جرد الدوال منفصل عن جرد صلاحيات الجداول: سؤال مختلف (مين ينفّذ إيه) وكل واحد بيكبر لوحده.
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

describe('function inventory', () => {
  it('lists every function; the one SECURITY DEFINER pins its search_path', async () => {
    const rows = await owner`
      SELECT proname, prosecdef, proconfig FROM pg_proc p
      WHERE pronamespace = 'public'::regnamespace AND NOT EXISTS (
        SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass
          AND d.deptype='e' AND e.extname='btree_gist') ORDER BY proname`;
    expect(Array.from(rows)).toEqual(FUNCTION_INVENTORY);
  });

  it('btree_gist is installed and its extension functions cannot acquire definer privileges', async () => {
    expect(await owner`SELECT 1 FROM pg_extension WHERE extname='btree_gist'`).toHaveLength(1);
    expect(
      await owner`SELECT p.proname FROM pg_proc p JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid
      JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND e.oid=d.refobjid
      WHERE d.deptype='e' AND e.extname='btree_gist' AND p.prosecdef`,
    ).toHaveLength(0);
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
