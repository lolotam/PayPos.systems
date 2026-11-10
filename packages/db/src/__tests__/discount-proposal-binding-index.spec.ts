import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import { pgUrl } from '../../test/pg-env.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { applyMigrations } from '../concurrent-migrations.ts';
import { migrationDataSteps } from '../data-steps/index.ts';

interface BindingIndexRow {
  columns: string[];
  nkeys: number;
  ncols: number;
  method: string;
  unique: boolean;
  predicate: string | null;
  valid: boolean;
  ready: boolean;
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

const EXPECTED_INDEX: BindingIndexRow = {
  columns: ['company_id', 'discount_proposal_id', 'id', 'business_id', 'service_id'],
  nkeys: 5,
  ncols: 5,
  method: 'btree',
  unique: false,
  predicate: null,
  valid: true,
  ready: true,
};

function bindingIndexes(connection: postgres.Sql) {
  // فهرس بادئة القيد أو أعمدة INCLUDE لا يثبت وجود المفتاح الكامل المطلوب.
  return connection<BindingIndexRow[]>`
    SELECT ARRAY(
      SELECT a.attname
      FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE k.ord <= i.indnkeyatts
      ORDER BY k.ord
    ) AS columns,
      i.indnkeyatts AS nkeys, i.indnatts AS ncols,
      am.amname AS method, i.indisunique AS unique,
      pg_get_expr(i.indpred, i.indrelid) AS predicate,
      i.indisvalid AS valid, i.indisready AS ready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indrelid = 'public.service_lines'::regclass`;
}

it('indexes the full discount-proposal binding FK with a ready nonpartial nonunique B-tree', async () => {
  expect(
    await bindingIndexes(owner),
    'service_lines needs the full five-column discount-proposal binding FK index',
  ).toContainEqual(EXPECTED_INDEX);
});

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));
const INDEX_NAME = 'service_lines_discount_proposal_binding_idx';
const PROPOSAL_ID = '01920000-0000-7000-8000-000000004110';

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

async function copyBaseline(folder: string) {
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const baseline = journal.entries.filter((entry) => entry.idx <= 216);
  const upgrade = journal.entries.find((entry) => entry.idx === 217);
  if (upgrade === undefined || !upgrade.tag.endsWith('_discount-proposal-binding-index')) {
    throw new Error('Expected tracked discount-proposal binding migration 0217');
  }
  expect(baseline.at(-1)?.idx).toBe(216);
  await mkdir(join(folder, 'meta'));
  for (const entry of [...baseline, upgrade]) {
    await copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  await writeFile(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: baseline }),
  );
  return { journal, baseline, upgrade };
}

async function withUpgradeDatabase(
  work: (connection: postgres.Sql, url: string, folder: string) => Promise<void>,
) {
  const pg = inject('pg');
  const name = `pospay_test_${pg.runId}_${randomBytes(4).toString('hex')}`;
  if (!/^pospay_test_[a-z0-9_]+$/.test(name)) throw new Error('Unsafe scratch database name');
  const cache = fileURLToPath(new URL('../../../../node_modules/.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const folder = await mkdtemp(join(cache, 'discount-binding-'));
  const url = pgUrl(pg, pg.ownerUser, pg.ownerPassword, name);
  const maintenance = postgres(pgUrl(pg, pg.ownerUser, pg.ownerPassword, 'postgres'), {
    max: 1,
    onnotice: () => undefined,
  });
  const connection = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined });
  let created = false;
  try {
    // لا نستنسخ القالب المرقّى: البداية template0 ثم ملفات الترحيل الحقيقية حتى 0216.
    await maintenance.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    await work(connection, url, folder);
  } finally {
    try {
      await connection.end();
      if (created) await maintenance.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await maintenance.end();
      await rm(folder, { recursive: true, force: true });
    }
  }
}

async function seedBoundProposal(connection: postgres.Sql, url: string) {
  await seedTwoTenants(url);
  await seedOrders(connection);
  const a = TENANT.A;
  await connection.begin(async (tx) => {
    await tx`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,
      kind,session_id,occurred_at,customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,
      requested_by,requested_by_membership_id,requester_limit_source,requester_limit_bps,requester_role,
      requester_role_is_system,requester_role_name_en,customer_first_name,requested_at,status,expires_at)
      VALUES(${a.company},${PROPOSAL_ID},${a.business},${a.branch},${PROPOSAL_ID},0,
      'RECORD',${ORDER_IDS.session},now(),${ORDER_IDS.customer},${ORDER_IDS.service},'Synthetic service',
      '{}'::jsonb,${'a'.repeat(64)},2000,${USER},${ORDER_IDS.membership},'PERSON',1000,'cashier',true,
      'Cashier','Synthetic',now(),'PENDING',now() + interval '1 day')`;
    await tx`UPDATE discount_proposals SET status='APPROVED',decided_by=${USER},
      decided_by_membership_id=${ORDER_IDS.membership},decided_via='REMOTE',decider_role='owner',
      decider_role_is_system=true,decider_role_name_en='Owner',decided_at=now(),
      approved_limit_source='OWNER',approver_is_performer=false
      WHERE company_id=${a.company} AND id=${PROPOSAL_ID}`;
    await tx`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${ORDER_IDS.line},
      consumed_at=now() WHERE company_id=${a.company} AND id=${PROPOSAL_ID}`;
    await tx`UPDATE service_lines SET discount_proposal_id=${PROPOSAL_ID}
      WHERE company_id=${a.company} AND id=${ORDER_IDS.line}`;
  });
}

const ledger = (connection: postgres.Sql) => connection`
  SELECT hash, created_at::text AS timestamp FROM drizzle.__drizzle_migrations ORDER BY id`;

const indexOid = (connection: postgres.Sql) => connection<{ oid: string | null }[]>`
  SELECT to_regclass(${'public.' + INDEX_NAME})::oid::text AS oid`;

const storedRows = (connection: postgres.Sql) => connection`
  SELECT
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY company_id,id) FROM service_lines l) AS lines,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY company_id,id) FROM discount_proposals p) AS proposals,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY company_id,id) FROM service_sessions s) AS sessions,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY company_id,id) FROM line_performers p) AS performers`;

it('upgrades populated 0216 through tracked 0217 once and preserves rows and index OID on rerun', async () => {
  await withUpgradeDatabase(async (connection, url, folder) => {
    const { journal, baseline, upgrade } = await copyBaseline(folder);
    const pg = inject('pg');
    const steps = migrationDataSteps(url, pg.appPassword, pg.dispatcherPassword);
    await applyMigrations(connection, folder, steps);
    expect(await ledger(connection)).toHaveLength(baseline.length);
    expect(await indexOid(connection)).toEqual([{ oid: null }]);
    expect(await bindingIndexes(connection)).not.toContainEqual(EXPECTED_INDEX);
    await seedBoundProposal(connection, url);
    expect(await connection`SELECT company_id FROM service_lines`).toHaveLength(2);
    expect(
      await connection`SELECT id FROM discount_proposals WHERE status='CONSUMED'`,
    ).toHaveLength(1);
    expect(
      await connection`SELECT discount_proposal_id FROM service_lines
        WHERE company_id=${TENANT.A.company} AND id=${ORDER_IDS.line}`,
    ).toEqual([{ discount_proposal_id: PROPOSAL_ID }]);
    const rowsBefore = await storedRows(connection);
    const ledgerBefore = await ledger(connection);

    // نغيّر نسخة السجل المؤقتة وحدها، ولا نزيّف readMigrationFiles أو SQL الترحيل.
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: [...baseline, upgrade] }),
    );
    const actual = readMigrationFiles({ migrationsFolder: folder }).at(-1);
    if (actual === undefined) throw new Error('Tracked migration 0217 was not parsed');
    expect(actual.folderMillis).toBe(upgrade.when);
    await applyMigrations(connection, folder, steps);
    expect(await bindingIndexes(connection)).toContainEqual(EXPECTED_INDEX);
    expect(await storedRows(connection)).toEqual(rowsBefore);
    const upgradedLedger = await ledger(connection);
    expect(upgradedLedger).toEqual([
      ...ledgerBefore,
      { hash: actual.hash, timestamp: String(actual.folderMillis) },
    ]);
    const oid = await indexOid(connection);
    expect(oid).toEqual([{ oid: expect.any(String) }]);

    await applyMigrations(connection, folder, steps);
    expect(await ledger(connection)).toEqual(upgradedLedger);
    expect(await indexOid(connection)).toEqual(oid);
    expect(await bindingIndexes(connection)).toContainEqual(EXPECTED_INDEX);
    expect(await storedRows(connection)).toEqual(rowsBefore);
  });
}, 120_000);
