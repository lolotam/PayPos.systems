import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { commissionSaleEvent } from './commission-tip-salary-events.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { createCommissionSaleProjectionScope } from '../persistence/commission-sale-projection.scope.ts';
import { COMMISSION_INPUTS_CONSUMER_ID } from '../commissions.module.ts';
import { markCommissionEventConsumed } from '../persistence/commission-event-consumption.ts';
import { ProjectPackageSale } from '../use-cases/project-package-sale/project-package-sale.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const SALE = '01970000-0000-7000-8000-000000000001';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_sales`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const saleRow = () =>
  owner`SELECT refunded_amount::text AS "refundedAmount",revision
    FROM commission_sales WHERE company_id=${A.company} AND sale_id=${SALE}`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;

interface SaleEventPayload {
  readonly business_id: string;
  readonly branch_id: string;
  readonly sale_id: string;
  readonly seller_employee_id: string;
  readonly business_date: string;
  readonly price_paid: string;
  readonly refunded_amount: string;
  readonly status: string;
  readonly revision: number;
}

/**
 * يفتح كاتب مراجعة أحدث معاملته ويأخذ قفل هوية البيع، ثم يتوقف خلف بوابة تُفتح يدوياً،
 * فيطبّق الحدث ويعلّم استهلاكه داخل معاملته نفسها زي ما يفعل الموصل.
 *
 * @param event حدث المراجعة الأحدث صاحب القفل
 * @returns وعد الاعتلال بعد أخذ القفل، وفتح البوابة، ووعد اكتمال المعاملة
 */
function openHeldSaleWriter(event: ClaimedEvent): {
  readonly holdsLock: Promise<void>;
  readonly openGate: () => void;
  readonly done: Promise<void>;
} {
  let signalHolds: () => void = () => undefined;
  const holdsLock = new Promise<void>((resolve) => {
    signalHolds = () => resolve(undefined);
  });
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = () => resolve(undefined);
  });
  const payload = event.payload as SaleEventPayload;
  const done = db.withTenant(A.company, async (tx) => {
    const scope = createCommissionSaleProjectionScope(tx, fakeBusinessTimeZone(A.business), ids);
    await scope.lockSale(SALE);
    signalHolds();
    await gate;
    await new ProjectPackageSale(scope, clock, ids).execute({
      companyId: A.company,
      eventId: event.id,
      businessId: payload.business_id,
      branchId: payload.branch_id,
      saleId: payload.sale_id,
      sellerEmployeeId: payload.seller_employee_id,
      businessDate: payload.business_date,
      pricePaid: payload.price_paid,
      refundedAmount: payload.refunded_amount,
      status: payload.status,
      revision: payload.revision,
    });
    await markCommissionEventConsumed(tx, COMMISSION_INPUTS_CONSUMER_ID, event.id);
  });
  return { holdsLock, openGate, done };
}

it('a revision that commits before a waiting older revision leaves the stale writer a no-op with its mark (CM-22b)', async () => {
  const revision1 = commissionSaleEvent(A, ids, { saleId: SALE });
  const revision2 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 2,
    refundedAmount: '10.000',
  });

  // الكاتب الأحدث يفتح معاملته ويأخذ قفل الهوية أولاً، ويبقى مفتوحاً خلف بوابة ملحوظة،
  // فترتيب «المراجعة 2 تُثبَّت قبل المراجعة 1» محسوم لا مرهون بجدولة الأقفال ولا بنوم مؤقت.
  const w2 = openHeldSaleWriter(revision2);
  await w2.holdsLock;

  // الكاتب الأقدم يُسلَّم والقفل محتجز، فينتظر خلفه بحتمية؛ ثم تُفتح البوابة، فتُطبَّق المراجعة 2
  // وتُثبَّت أولاً، ويعيد الكاتب الأقدم الفحص تحت القفل فيطبّق لا شيء ويُعلِّم حدثه فقط.
  const staleDelivery = deliver(revision1);
  w2.openGate();
  await w2.done;
  await staleDelivery;

  const rows = await saleRow();
  expect(rows).toEqual([{ refundedAmount: '10.000', revision: 2 }]);
  // الحدث الأقدم نُفِّذ no-op ومع ذلك عُلِّم استهلاكه، وعلامة الأحدث موجودة معه وحدهما.
  const marked = new Set((await marks()).map((row) => row.event_id));
  expect(marked.has(revision1.id)).toBe(true);
  expect(marked.has(revision2.id)).toBe(true);
  expect(marked.size).toBe(2);
});

it('any permutation of a fixed event set converges to the same row (CM-21)', async () => {
  const revision1 = commissionSaleEvent(A, ids, { saleId: SALE });
  const revision2 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 2,
    refundedAmount: '5.000',
  });
  const revision3 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 3,
    refundedAmount: '20.000',
  });
  const revision4 = commissionSaleEvent(A, ids, {
    saleId: SALE,
    revision: 4,
    refundedAmount: '30.000',
  });
  const permutations = [
    [revision1, revision2, revision3, revision4],
    [revision4, revision3, revision2, revision1],
    [revision2, revision4, revision1, revision3],
    [revision3, revision1, revision4, revision2],
    [revision2, revision1, revision3, revision4],
    [revision1, revision1, revision3, revision4, revision3],
  ];
  for (const permutation of permutations) {
    await owner`DELETE FROM commission_sales`;
    await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
    for (const event of permutation) {
      await deliver({ ...event, id: ids.newId() });
    }
    const rows = await saleRow();
    expect(rows).toEqual([{ refundedAmount: '30.000', revision: 4 }]);
  }
});
