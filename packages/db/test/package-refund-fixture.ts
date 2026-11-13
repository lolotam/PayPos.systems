import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { expect } from 'vitest';

import { createDatabase, type Database, type Tx } from '../src/index.ts';
import { ORDER_IDS, seedOrders } from './orders-fixture.ts';
import { redeem } from './package-redemption-fixture.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';
import { seedTwoTenants, TENANT, USER } from './tenancy-fixtures.ts';

const { A } = TENANT;

/** الشركة اللي عليها كل اختبارات الاسترداد؛ أول شركتين في الـ tenancy fixture. */
export const REFUND_TENANT = TENANT;
/** المسجّل اللي سجّل الجلسات والامتدادات في الفريق. */
export const REFUND_USER = USER;
export const REFUND_MEMBERSHIP = ORDER_IDS.membership;

export const REFUND_PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f501';
export const REFUND_CURRENT = '2026-12-30';
export const REFUND_NEXT = '2027-01-31';

/** نفس نوع الـ redemption اللي الـ redeem helper بيطلبه: المعرّفات UUID بقالب ثابت. */
type RedeemInput = Parameters<typeof redeem>[1];

/** معرّف UUID بالنوع نفسه اللي الـ redeem helper بيطلبه. */
export type RefundUuid = RedeemInput['entitlement'];

export type RefundSlot = {
  id: RefundUuid;
  ordinal: number;
  unitValue: string;
};

export interface RefundSale {
  entitlement: RefundUuid;
  component: RefundUuid;
  slots: RefundSlot[];
}

export interface RefundOptions {
  sessions?: number;
  amount?: string;
  entitlementRevision?: number;
  rows?: { index: number; ordinal?: number; unitValue?: string }[];
  refundedAmount?: string;
  revision?: number;
}

export interface RefundWrite extends RefundOptions {
  /** يفرّغ الفحوص المؤجلة جوّه المعاملة عشان يتقاس شغل الـ COMMIT لوحده. */
  flush?: boolean;
}

export interface RefundFixture {
  readonly owner: postgres.Sql;
  readonly appUrl: string;
  readonly db: Database;
  readonly nextId: () => RefundUuid;
  sell(sessions: number, unit?: string): Promise<RefundSale>;
  sellImported(sessions: number, used: number, unit?: string): Promise<RefundSale>;
  seedRefund(): Promise<{ entitlement: string; component: string; refund: string; slot: string }>;
  redeemSlot(sale: RefundSale, index: number): Promise<void>;
  refundStatements(tx: Tx, sale: RefundSale, id: string, options: RefundOptions): Promise<void>;
  writeRefund(sale: RefundSale, options?: RefundWrite): Promise<{ id: string; flushMs: number }>;
  close(): Promise<void>;
}

/** كل اللي الكاتبين محتاجينه: الشركة والفريق ومولد الهويات. */
interface RefundContext {
  readonly owner: postgres.Sql;
  readonly app: postgres.Sql;
  readonly db: Database;
  readonly nextId: () => RefundUuid;
}
type Failure = { code?: string; constraint_name?: string; cause?: Failure };

/** يثبت رفض العملية بالرمز وباسم القيد؛ القيد المؤجل بيظهر في الـ commit. */
export async function rejected(
  work: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as Failure;
  const actual = failure?.code ?? failure?.cause?.code;
  const name = failure?.constraint_name ?? failure?.cause?.constraint_name;
  if (constraint === undefined) {
    expect(actual).toBe(code);
    return;
  }
  expect([actual, name]).toEqual([code, constraint]);
}

/** المبلغ بالدينار ثلاث خانات: قيمة الجلسة الواحدة × عدد الجلسات. */
export function total(unit: string, count: number): string {
  const [whole = '0', fraction = ''] = unit.split('.');
  const mills = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  const sum = mills * BigInt(count);
  return `${sum / 1000n}.${(sum % 1000n).toString().padStart(3, '0')}`;
}

/** جلسة بالترتيب من البيع؛ الفهرس جاي من الاختبار نفسه فمفيش قيمة ناقصة. */
function slotOf(sale: RefundSale, index: number): RefundSlot {
  const slot = sale.slots[index];
  if (slot === undefined) throw new Error('Expected a session');
  return slot;
}

/** بيع كامل: الاستحقاق ومكوّنه وجلساته في معاملة واحدة (ختم التركيب). */
async function sell(context: RefundContext, sessions: number, unit = '1.000'): Promise<RefundSale> {
  const entitlement = context.nextId();
  const component = context.nextId();
  const amount = total(unit, sessions);
  await context.db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,
        refunded_amount,revision)
      VALUES (${A.company},${entitlement},${A.business},${ORDER_IDS.customer},${REFUND_PACKAGE_TYPE},'SOLD',
        'Synthetic package',30,${amount},${amount},0,0,'CASH',${ORDER_IDS.employee},${A.branch},
        '2026-10-01T08:00:00Z'::timestamptz,'2026-10-01','Asia/Kuwait',${USER},${ORDER_IDS.membership},
        ${REFUND_CURRENT},0,1)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      VALUES (${A.company},${component},${A.business},${entitlement},${ORDER_IDS.service},1,'Synthetic service',
        ${unit},${sessions},${amount})`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      SELECT ${A.company}::uuid, gen_random_uuid(), ${A.business}::uuid, ${entitlement}::uuid,
        ${component}::uuid, n, ${unit}::numeric, 'FREE' FROM generate_series(1, ${sessions}) n`);
  });
  return { entitlement, component, slots: await readSlots(context, entitlement) };
}

/** باقة مستوردة: تحتاج معاينة استيراد في نفس النشاط، وجلسة مستعملة واحدة. */
async function sellImported(
  context: RefundContext,
  sessions: number,
  used: number,
  unit = '1.000',
): Promise<RefundSale> {
  const file = context.nextId();
  const preview = context.nextId();
  await context.owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${A.company},${file},${A.business},'import',${file},'synthetic-import-file','application/pdf',
      10,'read:files:business',${USER},now())`;
  await context.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
    created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${A.company},${preview},${A.business},'packages',${file},${USER},now(),
      now()+interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  const entitlement = context.nextId();
  const component = context.nextId();
  const amount = total(unit, sessions);
  await context.db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,
        recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on)
      VALUES (${A.company},${entitlement},${A.business},${ORDER_IDS.customer},'IMPORTED','Synthetic package',
        ${amount},${USER},${ORDER_IDS.membership},${`EXT-${entitlement}`},${preview},1,${REFUND_CURRENT})`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      VALUES (${A.company},${component},${A.business},${entitlement},${ORDER_IDS.service},1,'Synthetic service',
        ${unit},${sessions},${amount})`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      SELECT ${A.company}::uuid, gen_random_uuid(), ${A.business}::uuid, ${entitlement}::uuid,
        ${component}::uuid, n, ${unit}::numeric,
        CASE WHEN n <= ${used} THEN 'IMPORTED_USED' ELSE 'FREE' END
      FROM generate_series(1, ${sessions}) n`);
  });
  return { entitlement, component, slots: await readSlots(context, entitlement) };
}

async function readSlots(context: RefundContext, entitlementId: string): Promise<RefundSlot[]> {
  return context.db.withTenant(A.company, (tx) =>
    tx.execute<RefundSlot>(sql`SELECT id, ordinal, unit_value::text AS "unitValue"
      FROM package_session_slots WHERE entitlement_id=${entitlementId} ORDER BY ordinal`),
  );
}

/** سطر الاسترداد وسطور جلساته وحالة الجلسات — جوه معاملة المستدعي. */
async function refundStatements(
  context: RefundContext,
  tx: Tx,
  sale: RefundSale,
  refundId: string,
  options: RefundOptions,
): Promise<void> {
  const rows = options.rows ?? [];
  await tx.execute(sql`INSERT INTO package_refunds
    (company_id,id,business_id,entitlement_id,component_id,branch_id,sessions,amount,method,reason,
      refunded_by,refunded_by_membership_id,refunded_at,entitlement_revision)
    VALUES (${A.company},${refundId},${A.business},${sale.entitlement},${sale.component},${A.branch},
      ${options.sessions ?? 1},${options.amount ?? '0.000'},'CASH','Synthetic refund',${USER},
      ${ORDER_IDS.membership},now(),${options.entitlementRevision ?? 2})`);
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${A.company}::uuid, ${context.nextId()}::uuid, ${A.business}::uuid, ${refundId}::uuid,
          ${sale.entitlement}::uuid, ${sale.component}::uuid, ${slotOf(sale, row.index).id}::uuid,
          ${row.ordinal ?? slotOf(sale, row.index).ordinal}::integer,
          ${row.unitValue ?? slotOf(sale, row.index).unitValue}::numeric)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`INSERT INTO package_refund_slots
    (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
    VALUES ${values}`);
  const ids = sql.join(
    rows.map((row) => sql`${slotOf(sale, row.index).id}::uuid`),
    sql`, `,
  );
  await tx.execute(sql`UPDATE package_session_slots SET state='REFUNDED' WHERE id IN (${ids})`);
}

/** استرداد كامل: السطر وسطوره وحالة الجلسات وحركة الاستحقاق في معاملة واحدة. */
async function writeRefund(
  context: RefundContext,
  sale: RefundSale,
  options: RefundWrite = {},
): Promise<{ id: string; flushMs: number }> {
  const refundId = context.nextId();
  let flushMs = 0;
  await context.db.withTenant(A.company, async (tx) => {
    await refundStatements(context, tx, sale, refundId, options);
    await tx.execute(sql`UPDATE package_entitlements
      SET refunded_amount=${options.refundedAmount ?? options.amount ?? '0.000'},
          revision=${options.revision ?? 2}
      WHERE id=${sale.entitlement}`);
    if (options.flush === true) {
      // شغل الفحوص المؤجلة هو شغل الـ COMMIT نفسه؛ تفريغها هنا بيقيسه لوحده.
      const started = performance.now();
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      flushMs = performance.now() - started;
    }
  });
  return { id: refundId, flushMs };
}

/** استرداع حقيقي كما يكتبه الكاتب: جلسة مستعملة بولاها استرداع حيّ. */
async function redeemSlot(context: RefundContext, sale: RefundSale, index: number): Promise<void> {
  const slot = slotOf(sale, index);
  const redemption: RedeemInput = {
    tenant: { company: A.company, business: A.business, branch: A.branch },
    value: slot.unitValue,
    entitlement: sale.entitlement,
    component: sale.component,
    slot: slot.id,
    redemption: context.nextId(),
    line: context.nextId(),
    session: context.nextId(),
  };
  await context.app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id',${A.company},true), set_config('app.user_id',${USER},true)`;
    await redeem(tx, redemption);
  });
}

/** استرداد كامل جاهز للقراءة من شركة تانية. */
async function seedRefund(
  context: RefundContext,
): Promise<{ entitlement: string; component: string; refund: string; slot: string }> {
  const sale = await sell(context, 1);
  const { id } = await writeRefund(context, sale, {
    sessions: 1,
    amount: '1.000',
    rows: [{ index: 0 }],
  });
  return {
    entitlement: sale.entitlement,
    component: sale.component,
    refund: id,
    slot: slotOf(sale, 0).id,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * الـ redemption بتطلب معرّفات UUID بقالب ثابت، والمولّد هنا بيبني النص بنفسه.
 * التحقق بيخلي النص يعدّي كـ UUID من غير cast، والـ ids بتفضل مرتبة بالإنشاء زي v7.
 */
function isUuid(value: string): value is RefundUuid {
  return UUID_PATTERN.test(value);
}

/** داتابيز اختبار واحدة فيها شركة A وفريقها: البيع والاسترداد والحماية يتقاسوا عليها. */
export async function refundFixture(): Promise<RefundFixture> {
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${REFUND_PACKAGE_TYPE},${A.business},'Synthetic package',1.000,30)`;
  const db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
  let serial = 0;
  const nextId = (): RefundUuid => {
    serial += 1;
    const id: string = `01920000-0000-7000-8000-${serial.toString(16).padStart(12, '0')}`;
    if (!isUuid(id)) throw new Error(`Generated id is not a UUID: ${id}`);
    return id;
  };
  const context: RefundContext = { owner, app, db, nextId };
  return {
    owner,
    appUrl: testDb.appUrl,
    db,
    nextId,
    sell: (sessions, unit) => sell(context, sessions, unit),
    sellImported: (sessions, used, unit) => sellImported(context, sessions, used, unit),
    seedRefund: () => seedRefund(context),
    redeemSlot: (sale, index) => redeemSlot(context, sale, index),
    refundStatements: (tx, sale, refundId, options) =>
      refundStatements(context, tx, sale, refundId, options),
    writeRefund: (sale, options) => writeRefund(context, sale, options),
    close: async () => {
      await db.close();
      await app.end();
      await owner.end();
      await testDb.drop();
    },
  };
}
