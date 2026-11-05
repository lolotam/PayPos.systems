import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f201';
const OTHER_BUSINESS = '01920000-0000-7000-8000-00000000f202';
const FILE = '01920000-0000-7000-8000-00000000f203';
const PREVIEW = '01920000-0000-7000-8000-00000000f204';
const PREVIEW_OTHER_BUSINESS = '01920000-0000-7000-8000-00000000f205';
const PREVIEW_SERVICES = '01920000-0000-7000-8000-00000000f206';
const MISSING_PREVIEW = '01920000-0000-7000-8000-00000000f207';
const SALE = '01920000-0000-7000-8000-00000000f208';
const SALE_COMPONENT = '01920000-0000-7000-8000-00000000f209';

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
    VALUES (${A.company},${PACKAGE_TYPE},${A.business},'Synthetic package',30.000,30)`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en)
    VALUES (${OTHER_BUSINESS},${A.company},'salon','Second A business')`;
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,
    content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${A.company},${FILE},${A.business},'import',${FILE},'synthetic-import-file','application/pdf',10,
    'read:files:business',${USER},now())`;
  await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,
    expires_at,row_count,error_count,rows,errors)
    VALUES (${A.company},${PREVIEW},${A.business},'packages',${FILE},${USER},now(),now() + interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb),
           (${A.company},${PREVIEW_OTHER_BUSINESS},${OTHER_BUSINESS},'packages',${FILE},${USER},now(),now() + interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb),
           (${A.company},${PREVIEW_SERVICES},${A.business},'services',${FILE},${USER},now(),now() + interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
  await sell(SALE, SALE_COMPONENT, 3);
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextId(): string {
  serial += 1;
  return `01920000-0000-7000-8000-00000000f${serial.toString(16).padStart(3, '0')}`;
}

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

const detail = (error: unknown) => {
  const failure = error as Failure;
  return {
    code: failure?.code ?? failure?.cause?.code,
    constraint: failure?.constraint_name ?? failure?.cause?.constraint_name,
  };
};

async function rejected(work: Promise<unknown>, code: string, constraint?: string): Promise<void> {
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
  id: string;
  provenance?: 'SOLD' | 'IMPORTED';
  pricePaid?: string;
  listPrice?: string | null;
  discount?: string | null;
  refundedAmount?: string;
  revision?: number;
  externalRef?: string | null;
  importBatchId?: string | null;
  importRow?: number | null;
  packageTypeId?: string | null;
  paidMethod?: string | null;
  sellerEmployeeId?: string | null;
  sellerLinkedUserId?: string | null;
  soldBusinessDate?: string | null;
  soldAt?: SQL | string | null;
  soldBranchId?: string | null;
  soldTimezone?: string | null;
  systemId?: string;
  txid?: string;
}

const entitlementInsert = (o: EntitlementOptions) => {
  const sold = o.provenance !== 'IMPORTED';
  return sql`
    INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
       price_paid,discount,discount_bps,paid_method,seller_employee_id,seller_linked_user_id,sold_branch_id,sold_at,
       sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,external_ref,import_batch_id,
       import_row,expires_on,refunded_amount,revision,created_system_id,created_txid)
    VALUES (${A.company},${o.id},${A.business},${ORDER_IDS.customer},
      ${o.packageTypeId === undefined ? (sold ? PACKAGE_TYPE : null) : o.packageTypeId},
      ${sold ? 'SOLD' : 'IMPORTED'},'Synthetic package',30,
      ${o.listPrice === undefined ? (sold ? '30.000' : null) : o.listPrice},
      ${o.pricePaid ?? '30.000'},
      ${o.discount === undefined ? (sold ? '0.000' : null) : o.discount},0,
      ${o.paidMethod === undefined ? (sold ? 'CASH' : null) : o.paidMethod},
      ${o.sellerEmployeeId === undefined ? (sold ? ORDER_IDS.employee : null) : o.sellerEmployeeId},
      ${o.sellerLinkedUserId ?? null},
      ${o.soldBranchId === undefined ? (sold ? A.branch : null) : o.soldBranchId},
      ${o.soldAt === undefined ? (sold ? sql`now()` : null) : o.soldAt},
      ${o.soldBusinessDate === undefined ? (sold ? sql`current_date` : null) : o.soldBusinessDate},
      ${o.soldTimezone === undefined ? (sold ? 'Asia/Kuwait' : null) : o.soldTimezone},
      ${USER},${ORDER_IDS.membership},
      ${o.externalRef === undefined ? (sold ? null : 'EXT-1') : o.externalRef},
      ${o.importBatchId === undefined ? (sold ? null : PREVIEW) : o.importBatchId},
      ${o.importRow === undefined ? (sold ? null : 1) : o.importRow},
      current_date + 30,${o.refundedAmount ?? '0.000'},${o.revision ?? 1},
      ${o.systemId ?? sql`public.pospay_system_id()`},${o.txid ?? sql`pg_current_xact_id()`})`;
};

interface ComponentOptions {
  value?: string;
  sessions?: number;
  listPrice?: string;
}

const componentInsert = (id: string, entitlementId: string, o: ComponentOptions = {}) => sql`
  INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
  VALUES (${A.company},${id},${A.business},${entitlementId},${ORDER_IDS.service},1,'Synthetic service',
    ${o.listPrice ?? '10.000'},${o.sessions ?? 3},${o.value ?? '30.000'})`;

interface SlotOptions {
  ordinal?: number;
  value?: string;
  state?: string;
  redemption?: string | null;
}

const slotInsert = (
  id: string,
  entitlementId: string,
  componentId: string,
  o: SlotOptions = {},
) => sql`
  INSERT INTO package_session_slots
    (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state,current_redemption_id)
  VALUES (${A.company},${id},${A.business},${entitlementId},${componentId},${o.ordinal ?? 1},
    ${o.value ?? '10.000'},${o.state ?? 'FREE'},${o.redemption ?? null})`;

const asApp = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });

/** محاولة كتابة واحدة: الـ transaction بيرجع خطأها زي ما هو. */
const attempt = (statement: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(statement));

/** بيع كامل: الاستحقاق ومكوّنه وجلساته؛ مجموع القيم 30.000 = السعر المدفوع. */
async function sell(
  entitlementId: string,
  componentId: string,
  slots: number,
  o: EntitlementOptions = { id: entitlementId },
): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(entitlementInsert({ ...o, id: entitlementId }));
    await tx.execute(componentInsert(componentId, entitlementId));
    for (let ordinal = 1; ordinal <= slots; ordinal += 1) {
      await tx.execute(slotInsert(nextId(), entitlementId, componentId, { ordinal }));
    }
  });
}

/** استحقاق ومكوّنه في نفس المعاملة، وبعدها الكلام اللي جاي بيتحقق. */
async function withSale(
  entitlementId: string,
  componentId: string,
  statement: ReturnType<typeof sql>,
  component: ComponentOptions = {},
): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(entitlementInsert({ id: entitlementId }));
    await tx.execute(componentInsert(componentId, entitlementId, component));
    await tx.execute(statement);
  });
}

it('the entitlement refuses every transition until its own row exists', async () => {
  await rejected(
    asApp(sql`UPDATE package_entitlements SET expires_on=current_date + 40 WHERE id=${SALE}`),
    '23514',
    'package_entitlements_expires_on_closed',
  );
  await rejected(
    asApp(sql`UPDATE package_entitlements SET refunded_amount=5.000 WHERE id=${SALE}`),
    '23514',
    'package_entitlements_refunded_amount_closed',
  );
  await rejected(
    asApp(sql`UPDATE package_entitlements SET revision=2 WHERE id=${SALE}`),
    '23514',
    'package_entitlements_revision_closed',
  );
  await rejected(
    owner`UPDATE package_entitlements SET name_en='Changed' WHERE id=${SALE}`,
    '23514',
    'package_entitlements_immutable',
  );
  await rejected(
    asApp(sql`UPDATE package_entitlements SET name_en='Changed' WHERE id=${SALE}`),
    '42501',
  );
});

it('the creation seal is kept from the creating transaction and never resealed', async () => {
  const [row] = await owner`SELECT created_system_id, created_txid::text AS xid
    FROM package_entitlements WHERE id=${SALE}`;
  const [cluster] = await owner`SELECT public.pospay_system_id() AS system_id`;
  expect(row?.['created_system_id']).toBe(cluster?.['system_id']);
  expect(row?.['xid']).not.toBe('0');
  await owner`UPDATE package_entitlements SET created_system_id=999, created_txid='12345'::xid8
    WHERE id=${SALE}`;
  const [after] = await owner`SELECT created_system_id, created_txid::text AS xid
    FROM package_entitlements WHERE id=${SALE}`;
  expect(after).toEqual(row);
});

it('the session refuses a state or a redemption that has no row behind it', async () => {
  await rejected(
    asApp(sql`UPDATE package_session_slots SET state='USED' WHERE entitlement_id=${SALE}`),
    '23514',
    'package_session_slots_state_redemption_check',
  );
  await rejected(
    asApp(sql`UPDATE package_session_slots SET current_redemption_id=${nextId()}
      WHERE entitlement_id=${SALE}`),
    '23514',
    'package_session_slots_state_redemption_check',
  );
  await rejected(
    owner`UPDATE package_session_slots SET unit_value=1.000 WHERE entitlement_id=${SALE}`,
    '23514',
    'package_session_slots_immutable',
  );
  await rejected(
    asApp(sql`UPDATE package_session_slots SET unit_value=1.000 WHERE entitlement_id=${SALE}`),
    '42501',
  );
});

it('the component is immutable and can still be locked for reading', async () => {
  await rejected(
    asApp(sql`UPDATE package_components SET lock_touch=lock_touch WHERE id=${SALE_COMPONENT}`),
    '23514',
    'package_components_immutable',
  );
  await rejected(
    asApp(sql`UPDATE package_components SET lock_touch=1 WHERE id=${SALE_COMPONENT}`),
    '23514',
    'package_components_immutable',
  );
  const locked = await asApp(
    sql`SELECT id FROM package_components WHERE id=${SALE_COMPONENT} FOR UPDATE`,
  );
  expect(Array.from(locked)).toEqual([{ id: SALE_COMPONENT }]);
});

it('an entitlement starts with no refunded amount and at revision one', async () => {
  await rejected(
    attempt(entitlementInsert({ id: nextId(), refundedAmount: '5.000' })),
    '23514',
    'package_entitlements_initial_refunded_amount',
  );
  await rejected(
    attempt(entitlementInsert({ id: nextId(), revision: 2 })),
    '23514',
    'package_entitlements_initial_revision',
  );
  await rejected(
    attempt(entitlementInsert({ id: nextId(), revision: 0 })),
    '23514',
    'package_entitlements_initial_revision',
  );
});

it('a new session starts free and carries no redemption', async () => {
  const entitlementId = nextId();
  const componentId = nextId();
  const slot = (options: SlotOptions) => slotInsert(nextId(), entitlementId, componentId, options);
  // حالة USED من غير استرداع بتقع على قيد الجدول نفسه قبل تريغر التركيب.
  const states: [string, string][] = [
    ['REFUNDED', 'package_session_slots_initial_state'],
    ['USED', 'package_session_slots_state_redemption_check'],
    ['IMPORTED_USED', 'package_session_slots_initial_state'],
  ];
  for (const [state, constraint] of states) {
    await rejected(
      withSale(
        entitlementId,
        componentId,
        slotInsert(nextId(), entitlementId, componentId, { state }),
      ),
      '23514',
      constraint,
    );
  }
  await rejected(
    withSale(entitlementId, componentId, slot({ redemption: nextId() })),
    '23514',
    'package_session_slots_state_redemption_check',
  );
  await rejected(
    withSale(entitlementId, componentId, slot({ state: 'USED', redemption: nextId() })),
    '23514',
    'package_session_slots_initial_state',
  );
});

it('the creation seal overwrites whatever the caller supplies', async () => {
  const entitlementId = nextId();
  await sell(entitlementId, nextId(), 3, { id: entitlementId, systemId: '999', txid: '12345' });
  const [row] = await owner`SELECT created_system_id, created_txid::text AS xid
    FROM package_entitlements WHERE id=${entitlementId}`;
  const [cluster] = await owner`SELECT public.pospay_system_id() AS system_id`;
  expect(row?.['created_system_id']).toBe(cluster?.['system_id']);
  expect(row?.['xid']).not.toBe('12345');
});

it('an import names a packages preview of its own business', async () => {
  for (const batch of [PREVIEW_OTHER_BUSINESS, PREVIEW_SERVICES, MISSING_PREVIEW]) {
    await rejected(
      attempt(
        entitlementInsert({
          id: nextId(),
          provenance: 'IMPORTED',
          importBatchId: batch,
          importRow: 7,
          externalRef: `EXT-${batch.slice(-4)}`,
        }),
      ),
      '23514',
      'package_entitlements_import_preview',
    );
  }
});

it('the row shape follows its provenance', async () => {
  await rejected(
    attempt(entitlementInsert({ id: nextId(), provenance: 'IMPORTED', importBatchId: null })),
    '23514',
    'package_entitlements_imported_shape_check',
  );
  await rejected(
    attempt(entitlementInsert({ id: nextId(), provenance: 'IMPORTED', sellerLinkedUserId: USER })),
    '23514',
    'package_entitlements_imported_shape_check',
  );
  // الاستيراد مالوش لحظة بيع ولا فرع ولا منطقة زمنية؛ السطر كله يترفض بالقيد (FR-065).
  await rejected(
    attempt(entitlementInsert({ id: nextId(), provenance: 'IMPORTED', soldAt: sql`now()` })),
    '23514',
    'package_entitlements_imported_shape_check',
  );
  await rejected(
    attempt(entitlementInsert({ id: nextId(), provenance: 'IMPORTED', soldBranchId: A.branch })),
    '23514',
    'package_entitlements_imported_shape_check',
  );
  await rejected(
    attempt(
      entitlementInsert({
        id: nextId(),
        provenance: 'IMPORTED',
        soldTimezone: 'Asia/Kuwait',
      }),
    ),
    '23514',
    'package_entitlements_imported_shape_check',
  );
  await rejected(
    attempt(entitlementInsert({ id: nextId(), importBatchId: PREVIEW, importRow: 3 })),
    '23514',
    'package_entitlements_sold_shape_check',
  );
});

it('a duplicate import row is refused', async () => {
  const duplicate = (externalRef: string) =>
    entitlementInsert({
      id: nextId(),
      provenance: 'IMPORTED',
      importBatchId: PREVIEW,
      importRow: 9,
      externalRef,
    });
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(duplicate('EXT-DUP-1'));
      await tx.execute(duplicate('EXT-DUP-2'));
    }),
    '23505',
    'package_entitlements_import_row_key',
  );
});
