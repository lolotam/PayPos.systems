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

/** يرجع دوال public (عدا امتداد btree_gist) ليتحقق الجرد والحد الأمني من نفس القائمة. */
async function listPublicFunctions() {
  return owner<{ proname: string; prosecdef: boolean; proconfig: string[] | null }[]>`
    SELECT proname, prosecdef, proconfig FROM pg_proc p
    WHERE pronamespace = 'public'::regnamespace AND NOT EXISTS (
      SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass
        AND d.deptype='e' AND e.extname='btree_gist') ORDER BY proname`;
}

/** يطابق مسافات محلّل PostgreSQL فقط (`scanner_isspace`: مسافة، tab، LF، CR، FF دون `\v` أو Unicode). */
function isPgSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** يقرأ معرّف PostgreSQL واحداً من قائمة search_path ويفك الاقتباس إن وُجد. */
function readSearchPathToken(raw: string, start: number): { ident: string; next: number } | null {
  let i = start;
  while (i < raw.length && isPgSpace(raw[i])) i += 1;
  if (i >= raw.length) return null;
  if (raw[i] !== '"') {
    const tokenStart = i;
    while (i < raw.length && raw[i] !== ',' && raw[i] !== '"' && !isPgSpace(raw[i])) i += 1;
    const ident = raw.slice(tokenStart, i).toLowerCase();
    while (i < raw.length && isPgSpace(raw[i])) i += 1;
    return ident.length > 0 ? { ident, next: i } : null;
  }
  i += 1;
  let ident = '';
  while (i < raw.length) {
    if (raw[i] === '"' && raw[i + 1] === '"') {
      ident += '"';
      i += 2;
      continue;
    }
    if (raw[i] === '"') {
      i += 1;
      while (i < raw.length && isPgSpace(raw[i])) i += 1;
      return ident.length > 0 ? { ident, next: i } : null;
    }
    ident += raw[i] ?? '';
    i += 1;
  }
  return null;
}

/** يفكك قيمة search_path إلى أسماء مخططات معيارية، أو يرجع null عند صيغة مكسورة أو خانة فارغة. */
function parseSearchPath(raw: string): string[] | null {
  const schemas: string[] = [];
  let cursor = 0;
  while (cursor <= raw.length) {
    const token = readSearchPathToken(raw, cursor);
    if (token === null) return null;
    schemas.push(token.ident);
    if (token.next === raw.length) return schemas;
    if (raw[token.next] !== ',') return null;
    cursor = token.next + 1;
  }
  return null;
}

/** يتأكد إن search_path فيه مخطط واحد على الأقل قبل pg_temp وإن pg_temp يظهر مرة واحدة في الآخر بس. */
function hasTrailingPgTemp(proconfig: readonly string[] | null): boolean {
  const searchPath = (proconfig ?? []).find((entry) => entry.startsWith('search_path='));
  if (searchPath === undefined) return false;
  const schemas = parseSearchPath(searchPath.slice('search_path='.length));
  return (
    schemas !== null &&
    schemas.length >= 2 &&
    schemas.filter((s) => s === 'pg_temp').length === 1 &&
    schemas.at(-1) === 'pg_temp'
  );
}

describe('hasTrailingPgTemp', () => {
  it('accepts trailing pg_temp once and refuses earlier, duplicate, quoted, NBSP, empty or solo entries', () => {
    expect(hasTrailingPgTemp(['search_path=pg_catalog, pg_temp'])).toBe(true);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, public, pg_temp'])).toBe(true);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, "pg,temp", pg_temp'])).toBe(true);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, \u00a0pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, public\u00a0, pg_temp'])).toBe(true);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, \vpg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=pg_catalog, public\v, pg_temp'])).toBe(true);
    expect(hasTrailingPgTemp(['search_path=pg_temp, public, pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=pg_temp, public'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path="pg_temp", public'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path="pg_temp", public, pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=PG_TEMP, public'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path="unterminated, pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(['search_path=, pg_temp'])).toBe(false);
    expect(hasTrailingPgTemp(null)).toBe(false);
  });
});

describe('function inventory', () => {
  it('lists every function; the one SECURITY DEFINER pins its search_path', async () => {
    expect(Array.from(await listPublicFunctions())).toEqual(FUNCTION_INVENTORY);
  });

  // PP-286 T-9 (#984): كل دالة جديدة أو معدَّلة في public لازم ينتهي search_path بتاعها بـ pg_temp.
  it('requires every public function search_path to end with pg_temp', async () => {
    const missing = (await listPublicFunctions())
      .filter((row) => !hasTrailingPgTemp(row.proconfig))
      .map((row) => row.proname);
    expect(missing).toEqual([]);
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

  // الختم بيتقرأ من معرّف الـ cluster، فالـ runtime role هو الوحيد اللي لازم ينفّذ الدالة دي.
  it('only pospay_app may execute the cluster identifier reader', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ role: string }[]>`
      SELECT r AS role FROM unnest(${APP_ROLES}::text[]) AS r
      WHERE has_function_privilege(r, 'pospay_system_id()', 'EXECUTE')`,
    );
    expect(rows.map((r) => r.role)).toEqual(['pospay_app']);
  });

  it('the cluster identifier reader is not exposed to PUBLIC', async () => {
    const [row] = await owner`
      SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid='public.pospay_system_id()'::regprocedure`;
    expect(row?.acl?.includes('{=X/')).toBe(false);
    expect(row?.acl?.includes(',=X/')).toBe(false);
  });
});
