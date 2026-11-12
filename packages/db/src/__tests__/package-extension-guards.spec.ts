import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f301';
const CURRENT = '2026-12-30';
const NEXT = '2027-01-31';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let serial = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${PACKAGE_TYPE},${A.business},'Synthetic package',1.000,30)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextId(): string {
  serial += 1;
  return `01920000-0000-7000-8000-${serial.toString(16).padStart(12, '0')}`;
}

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

function detail(error: unknown) {
  const failure = error as Failure;
  return {
    code: failure?.code ?? failure?.cause?.code,
    constraint: failure?.constraint_name ?? failure?.cause?.constraint_name,
  };
}

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const found = detail(error);
  if (constraint === undefined) {
    expect(found.code).toBe(code);
    return;
  }
  expect([found.code, found.constraint]).toEqual([code, constraint]);
}

interface EntitlementOptions {
  provenance?: 'SOLD' | 'IMPORTED';
  refundedAmount?: string;
  revision?: number;
  importBatchId?: string;
  forged?: boolean;
}

function entitlementInsert(id: string, o: EntitlementOptions = {}): SQL {
  const imported = o.provenance === 'IMPORTED';
  return sql`INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
      price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
      sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,external_ref,import_batch_id,
      import_row,expires_on,refunded_amount,revision,expires_on_changed_system_id,expires_on_changed_txid,
      expires_on_before)
    VALUES (${A.company},${id},${A.business},${ORDER_IDS.customer},${imported ? null : PACKAGE_TYPE},
      ${imported ? 'IMPORTED' : 'SOLD'},'Synthetic package',${imported ? null : 30},${imported ? null : '1.000'},
      '1.000',${imported ? null : '0.000'},0,${imported ? null : 'CASH'},${imported ? null : ORDER_IDS.employee},
      ${imported ? null : A.branch},${imported ? null : sql`'2026-10-01T08:00:00Z'::timestamptz`},
      ${imported ? null : '2026-10-01'},${imported ? null : 'Asia/Kuwait'},${USER},${ORDER_IDS.membership},
      ${imported ? `EXT-${id}` : null},${imported ? (o.importBatchId ?? nextId()) : null},${imported ? 1 : null},
      ${CURRENT},${o.refundedAmount ?? '0.000'},${o.revision ?? 1},${o.forged === true ? 999 : null},
      ${o.forged === true ? sql`'12345'::xid8` : sql`NULL`},${o.forged === true ? '2020-01-01' : null})`;
}

async function sell(id = nextId(), o: EntitlementOptions = {}) {
  const component = nextId();
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(entitlementInsert(id, o));
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      VALUES (${A.company},${component},${A.business},${id},${ORDER_IDS.service},1,'Synthetic service',1.000,1,1.000)`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${nextId()},${A.business},${id},${component},1,1.000,'FREE')`);
  });
  return { entitlement: id, component };
}

interface ExtensionOptions {
  previous?: string;
  next?: string;
  reason?: string;
}

function extensionInsert(entitlement: string, o: ExtensionOptions = {}): SQL {
  return sql`INSERT INTO package_extensions
    (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
      extended_by,extended_by_membership_id,extended_at)
    VALUES (${A.company},${nextId()},${A.business},${entitlement},${A.branch},${o.previous ?? CURRENT},
      ${o.next ?? NEXT},${o.reason ?? 'Synthetic extension'},${USER},${ORDER_IDS.membership},now())`;
}

async function extend(entitlement: string, o: ExtensionOptions = {}) {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(extensionInsert(entitlement, o));
    await tx.execute(sql`UPDATE package_entitlements SET expires_on=${o.next ?? NEXT} WHERE id=${entitlement}`);
  });
}

it('commits a paired expiry change and records the cluster, transaction and previous date', async () => {
  const sale = await sell();
  await extend(sale.entitlement);
  const [row] = await owner`SELECT expires_on_changed_system_id::text AS sid,
    expires_on_changed_txid::text AS txid,expires_on_before::text AS previous,expires_on::text AS current
    FROM package_entitlements WHERE id=${sale.entitlement}`;
  const [cluster] = await owner`SELECT public.pospay_system_id()::text AS sid`;
  expect(row).toMatchObject({ sid: cluster?.['sid'], previous: CURRENT, current: NEXT });
  expect(row?.['txid']).not.toBe('0');
  expect(await owner`SELECT previous_expires_on::text AS previous,new_expires_on::text AS next
    FROM package_extensions WHERE entitlement_id=${sale.entitlement}`)
    .toEqual([{ previous: CURRENT, next: NEXT }]);
});

it('refuses to lower expires_on', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE package_entitlements SET expires_on='2026-12-29' WHERE id=${sale.entitlement}`),
    ),
    '23514',
    'package_entitlements_expires_on_forward_only',
  );
});

it('refuses a second expiry change in one transaction', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(extensionInsert(sale.entitlement));
      await tx.execute(sql`UPDATE package_entitlements SET expires_on=${NEXT} WHERE id=${sale.entitlement}`);
      await tx.execute(sql`UPDATE package_entitlements SET expires_on='2027-02-01' WHERE id=${sale.entitlement}`);
    }),
    '23514',
    'package_entitlements_expires_on_once',
  );
});

it('refuses an expiry change without its extension row at commit', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE package_entitlements SET expires_on=${NEXT} WHERE id=${sale.entitlement}`),
    ),
    '23514',
    'package_entitlements_extension_missing',
  );
});

it('refuses an extension row without an expiry change at commit', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, (tx) => tx.execute(extensionInsert(sale.entitlement))),
    '23514',
    'package_extensions_history_mismatch',
  );
});

it.each([
  { previous: '2026-12-29', next: NEXT },
  { previous: CURRENT, next: '2027-02-01' },
])('refuses mismatched extension history %j', async (dates) => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(extensionInsert(sale.entitlement, dates));
      await tx.execute(sql`UPDATE package_entitlements SET expires_on=${NEXT} WHERE id=${sale.entitlement}`);
    }),
    '23514',
    'package_extensions_history_mismatch',
  );
});

it('refuses duplicate history for the same entitlement and previous date', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(extensionInsert(sale.entitlement));
      await tx.execute(extensionInsert(sale.entitlement));
    }),
    '23505',
    'package_extensions_entitlement_previous_key',
  );
});

it('fails an unmatched row immediately and accepts it after constraints return to deferred', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      await tx.execute(extensionInsert(sale.entitlement));
    }),
    '23514',
    'package_extensions_history_mismatch',
  );
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
    await tx.execute(extensionInsert(sale.entitlement));
    await tx.execute(sql`UPDATE package_entitlements SET expires_on=${NEXT} WHERE id=${sale.entitlement}`);
  });
  expect(await owner`SELECT id FROM package_extensions WHERE entitlement_id=${sale.entitlement}`)
    .toHaveLength(1);
});

it('allows an update that leaves expires_on and its trigger metadata untouched', async () => {
  const sale = await sell();
  await db.withTenant(A.company, (tx) =>
    tx.execute(sql`UPDATE package_entitlements SET expires_on=expires_on WHERE id=${sale.entitlement}`),
  );
  expect(await owner`SELECT expires_on_changed_system_id,expires_on_changed_txid,expires_on_before
    FROM package_entitlements WHERE id=${sale.entitlement}`)
    .toEqual([{ expires_on_changed_system_id: null, expires_on_changed_txid: null, expires_on_before: null }]);
});

it('closes direct metadata writes and nulls forged metadata on insert', async () => {
  const sale = await sell();
  await rejected(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE package_entitlements SET expires_on_changed_txid='12345'::xid8
        WHERE id=${sale.entitlement}`),
    ),
    '42501',
  );
  const forged = await sell(nextId(), { forged: true });
  expect(await owner`SELECT expires_on_changed_system_id,expires_on_changed_txid,expires_on_before
    FROM package_entitlements WHERE id=${forged.entitlement}`)
    .toEqual([{ expires_on_changed_system_id: null, expires_on_changed_txid: null, expires_on_before: null }]);
});

it('keeps refunded_amount and revision closed and enforces their initial values', async () => {
  const sale = await sell();
  for (const [column, constraint] of [
    ['refunded_amount', 'package_entitlements_refunded_amount_closed'],
    ['revision', 'package_entitlements_revision_closed'],
  ] as const) {
    await rejected(
      db.withTenant(A.company, (tx) =>
        tx.execute(sql`UPDATE package_entitlements SET ${sql.identifier(column)}=2 WHERE id=${sale.entitlement}`),
      ),
      '23514',
      constraint,
    );
  }
  await rejected(sell(nextId(), { refundedAmount: '0.001' }), '23514', 'package_entitlements_initial_refunded_amount');
  await rejected(sell(nextId(), { revision: 2 }), '23514', 'package_entitlements_initial_revision');
});

it('keeps other columns immutable, preserves the creation seal and validates import previews', async () => {
  const sale = await sell();
  const [before] = await owner`SELECT created_system_id,created_txid FROM package_entitlements WHERE id=${sale.entitlement}`;
  await owner`UPDATE package_entitlements SET created_system_id=999,created_txid='12345'::xid8 WHERE id=${sale.entitlement}`;
  const [after] = await owner`SELECT created_system_id,created_txid FROM package_entitlements WHERE id=${sale.entitlement}`;
  expect(after).toEqual(before);
  await rejected(
    owner`UPDATE package_entitlements SET name_en='Changed' WHERE id=${sale.entitlement}`,
    '23514',
    'package_entitlements_immutable',
  );
  await rejected(
    sell(nextId(), { provenance: 'IMPORTED', importBatchId: nextId() }),
    '23514',
    'package_entitlements_import_preview',
  );
});
