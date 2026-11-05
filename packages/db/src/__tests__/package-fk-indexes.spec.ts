import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

/** جداول تخزين بيع الباقات؛ القصيرة بتتوسّع مع كل شريحة بعد كده. */
export const PACKAGE_STORAGE_TABLES = [
  'package_entitlements',
  'package_components',
  'package_session_slots',
  'package_redemptions',
] as const;

interface ExpectedForeignKey {
  name: string;
  columns: string[];
}

const EXPECTED_FOREIGN_KEYS: Record<string, ExpectedForeignKey[]> = {
  package_entitlements: [
    { name: 'package_entitlements_company_id_companies_id_fk', columns: ['company_id'] },
    { name: 'package_entitlements_customer_fk', columns: ['company_id', 'customer_id'] },
    {
      name: 'package_entitlements_package_type_fk',
      columns: ['company_id', 'business_id', 'package_type_id'],
    },
    {
      name: 'package_entitlements_seller_employee_fk',
      columns: ['company_id', 'business_id', 'seller_employee_id'],
    },
    { name: 'package_entitlements_seller_user_fk', columns: ['seller_linked_user_id'] },
    {
      name: 'package_entitlements_sold_branch_fk',
      columns: ['company_id', 'business_id', 'sold_branch_id'],
    },
    { name: 'package_entitlements_recorder_fk', columns: ['recorded_by'] },
    {
      name: 'package_entitlements_recorder_membership_fk',
      columns: ['company_id', 'recorded_by', 'recorded_by_membership_id'],
    },
  ],
  package_components: [
    { name: 'package_components_company_id_companies_id_fk', columns: ['company_id'] },
    {
      name: 'package_components_entitlement_fk',
      columns: ['company_id', 'business_id', 'entitlement_id'],
    },
    {
      name: 'package_components_service_fk',
      columns: ['company_id', 'business_id', 'service_id'],
    },
  ],
  package_session_slots: [
    { name: 'package_session_slots_redemption_fk', columns: ['company_id','business_id','current_redemption_id'] },
    { name: 'package_session_slots_company_id_companies_id_fk', columns: ['company_id'] },
    {
      name: 'package_session_slots_component_fk',
      columns: ['company_id', 'business_id', 'entitlement_id', 'component_id'],
    },
  ],
  package_redemptions: [
    { name: 'package_redemptions_company_id_companies_id_fk', columns: ['company_id'] },
    { name: 'package_redemptions_recorded_by_user_id_fk', columns: ['recorded_by'] },
    { name: 'package_redemptions_component_fk', columns: ['company_id','business_id','entitlement_id','component_id'] },
    { name: 'package_redemptions_slot_fk', columns: ['company_id','business_id','slot_id'] },
    { name: 'package_redemptions_line_fk', columns: ['company_id','business_id','line_id'] },
    { name: 'package_redemptions_membership_fk', columns: ['company_id','recorded_by','recorded_by_membership_id'] },
    { name: 'package_redemptions_cancellation_fk', columns: ['company_id','reversal_cancellation_id'] },
  ],
};

interface ForeignKeyRow {
  name: string;
  parent: string;
  columns: string[];
}

interface IndexRow {
  name: string;
  columns: string[];
  nkeys: number;
  ncols: number;
  method: string;
  valid: boolean;
  ready: boolean;
  predicate: string | null;
}

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

const foreignKeys = (table: string) =>
  owner<ForeignKeyRow[]>`
    SELECT c.conname AS name, c.confrelid::regclass::text AS parent,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid = ${table}::regclass
    ORDER BY c.conname`;

/** أعمدة الفهرس المفتاحية بس: أعمدة INCLUDE ما بتعدّش (indnkeyatts). */
const indexes = (table: string) =>
  owner<IndexRow[]>`
    SELECT i.indexrelid::regclass::text AS name,
      ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            WHERE k.ord <= i.indnkeyatts ORDER BY k.ord) AS columns,
      i.indnkeyatts AS nkeys, i.indnatts AS ncols, am.amname AS method,
      i.indisvalid AS valid, i.indisready AS ready,
      pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indrelid = ${table}::regclass
    ORDER BY i.indexrelid::regclass::text`;

const nullableColumns = async (table: string): Promise<Set<string>> => {
  const rows = await owner<{ attname: string }[]>`
    SELECT attname FROM pg_attribute
    WHERE attrelid = ${table}::regclass AND attnum > 0 AND NOT attnotnull`;
  return new Set(rows.map((row) => row.attname));
};

/** الفهرس بيخدم المفتاج الأجنبي لو أعمدته المفتاحية بتبدأ بأعمدته بالترتيب. */
const supports = (index: IndexRow, columns: string[], nullable: Set<string>): boolean => {
  if (index.method !== 'btree' || !index.valid || !index.ready) return false;
  if (index.columns.length < columns.length) return false;
  if (!columns.every((column, position) => index.columns[position] === column)) return false;
  if (index.predicate === null) return true;
  // الفهرس الجزئي بيعدّ بس لو شرطه بالظبط عمود مفتاح أجنبي nullable مش NULL.
  const match = /^\(([a-z_]+) IS NOT NULL\)$/.exec(index.predicate);
  const column = match?.[1];
  if (column === undefined) return false;
  return columns.includes(column) && nullable.has(column);
};

it('the package storage carries the expected foreign keys', async () => {
  for (const table of PACKAGE_STORAGE_TABLES) {
    const found = await foreignKeys(table);
    const sorted = found
      .map((fk) => ({ name: fk.name, columns: fk.columns }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted).toEqual(
      [...(EXPECTED_FOREIGN_KEYS[table] ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
});

it('every foreign key of the package storage has a supporting index', async () => {
  for (const table of [...PACKAGE_STORAGE_TABLES, 'service_lines']) {
    const nullable = await nullableColumns(table);
    const candidates = await indexes(table);
    for (const fk of await foreignKeys(table)) {
      // 43-1 owns this new FK only; older service-line FK coverage belongs to its existing slices.
      if (table === 'service_lines' && fk.name !== 'service_lines_redemption_fk') continue;
      const supporting = candidates.filter((index) => supports(index, fk.columns, nullable));
      expect(supporting.length, `${table}.${fk.name}`).toBeGreaterThan(0);
    }
  }
});

it('circular redemption FKs have exact parents, columns and deferred timing', async () => {
  const rows = await owner`SELECT conname, confrelid::regclass::text AS parent, condeferrable, condeferred,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n,o)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS columns,
    ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n,o)
      JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS parent_columns
    FROM pg_constraint c WHERE conname IN ('package_redemptions_slot_fk','package_redemptions_line_fk',
      'package_redemptions_cancellation_fk','service_lines_redemption_fk','package_session_slots_redemption_fk') ORDER BY conname`;
  expect(rows.map((r) => [r.conname,r.parent,r.columns,r.parent_columns,r.condeferrable,r.condeferred])).toEqual([
    ['package_redemptions_cancellation_fk','service_line_cancellations',['company_id','reversal_cancellation_id'],['company_id','id'],true,true],
    ['package_redemptions_line_fk','service_lines',['company_id','business_id','line_id'],['company_id','business_id','id'],true,true],
    ['package_redemptions_slot_fk','package_session_slots',['company_id','business_id','slot_id'],['company_id','business_id','id'],true,true],
    ['package_session_slots_redemption_fk','package_redemptions',['company_id','business_id','current_redemption_id'],['company_id','business_id','id'],true,true],
    ['service_lines_redemption_fk','package_redemptions',['company_id','business_id','redemption_id'],['company_id','business_id','id'],true,true],
  ]);
});

it('the online migration finishes with validated redemption FKs', async () => {
  const rows=await owner`SELECT conname,convalidated FROM pg_constraint
    WHERE conname IN ('service_lines_redemption_fk','package_session_slots_redemption_fk') ORDER BY conname`;
  expect(rows).toEqual([
    { conname:'package_session_slots_redemption_fk',convalidated:true },
    { conname:'service_lines_redemption_fk',convalidated:true },
  ]);
});

it('slot validation queues only changed state or redemption updates, never bulk slot inserts', async () => {
  const [trigger]=await owner`SELECT tgtype::int AS events,tgdeferrable,tginitdeferred,
    ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY k(n,o)
      JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.n ORDER BY k.o) AS columns,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
    WHERE tgrelid='package_session_slots'::regclass AND tgname='package_session_slots_redemption_complete'`;
  expect(trigger).toMatchObject({ events:17,tgdeferrable:true,tginitdeferred:true,columns:['state','current_redemption_id'] });
  expect(trigger?.definition).toContain('old.state IS DISTINCT FROM new.state');
  expect(trigger?.definition).toContain('old.current_redemption_id IS DISTINCT FROM new.current_redemption_id');
});

it('paid line writes do not queue deferred redemption validation', async () => {
  const [trigger]=await owner`SELECT pg_get_triggerdef(oid) AS definition,tgdeferrable,tginitdeferred
    FROM pg_trigger WHERE tgrelid='service_lines'::regclass AND tgname='service_lines_redemption_complete'`;
  expect(trigger).toMatchObject({ tgdeferrable:true,tginitdeferred:true });
  expect(trigger?.definition).toContain('new.redemption_id IS NOT NULL');
});

it('a partial index counts only when its predicate is the nullable foreign key column', async () => {
  const table = 'package_entitlements';
  const nullable = await nullableColumns(table);
  const candidates = await indexes(table);
  const partial = candidates.filter((index) => index.predicate !== null);
  expect(partial.length).toBeGreaterThan(0);
  for (const index of partial) {
    const match = /^\(([a-z_]+) IS NOT NULL\)$/.exec(index.predicate ?? '');
    expect(match, index.name).not.toBeNull();
    expect(nullable.has(match?.[1] ?? ''), index.name).toBe(true);
  }
});

it('include columns never make an index support a foreign key', async () => {
  const table = 'package_session_slots';
  const foreign = (await foreignKeys(table)).find(
    (key) => key.name === 'package_session_slots_component_fk',
  );
  if (foreign === undefined) throw new Error('the session slot component foreign key is missing');
  const nullable = await nullableColumns(table);
  await owner`CREATE INDEX package_session_slots_include_probe
    ON package_session_slots (company_id, business_id) INCLUDE (entitlement_id, component_id)`;
  const candidates = await indexes(table);
  const probe = candidates.find((index) => index.name === 'package_session_slots_include_probe');
  if (probe === undefined) throw new Error('the probe index is missing');
  expect(probe.nkeys).toBe(2);
  expect(probe.ncols).toBe(4);
  expect(supports(probe, foreign.columns, nullable)).toBe(false);
  expect(candidates.some((index) => supports(index, foreign.columns, nullable))).toBe(true);
});
