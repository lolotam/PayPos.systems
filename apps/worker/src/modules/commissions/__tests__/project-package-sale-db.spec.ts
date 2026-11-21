import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  OTHER_COMMISSION_IDS,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { commissionSaleEvent } from './commission-tip-salary-events.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { createCommissionSaleProjectionScope } from '../persistence/commission-sale-projection.scope.ts';
import { ProjectPackageSale } from '../use-cases/project-package-sale/project-package-sale.ts';
import { onCommissionInputEvent } from '../events/handlers/on-commission-input-event.handler.ts';
import type { CommissionInputUseCases } from '../events/handlers/on-commission-input-event.handler.ts';
import { recordCommissionFailureCodes } from '../index.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: ReturnType<typeof createDeliverer>;
const failures = new Map<string, string>();
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  deliver = createDeliverer(db, [recordCommissionFailureCodes(consumer, failures)], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  failures.clear();
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_sales`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const saleEvent = (saleId: string, overrides: Record<string, unknown> = {}) =>
  commissionSaleEvent(A, ids, { saleId, ...overrides });
const saleRow = (saleId: string) =>
  owner`SELECT business_id AS "businessId",sale_id AS "saleId",branch_id AS "branchId",
    seller_employee_id AS "sellerEmployeeId",business_date::text AS "businessDate",period,
    price_paid::text AS "pricePaid",refunded_amount::text AS "refundedAmount",status,revision
    FROM commission_sales WHERE company_id=${A.company} AND sale_id=${saleId}`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
const SALE = '01970000-0000-7000-8000-000000000001';

it('projects revision 1 with the event values, the period from the business date, and marks the event', async () => {
  await deliver(saleEvent(SALE));
  const rows = await saleRow(SALE);
  expect(rows).toEqual([
    {
      businessId: A.business,
      saleId: SALE,
      branchId: A.branch,
      sellerEmployeeId: A.employee,
      businessDate: '2026-11-01',
      period: '2026-11',
      pricePaid: '30.000',
      refundedAmount: '0.000',
      status: 'SOLD',
      revision: 1,
    },
  ]);
  expect((await marks()).length).toBe(1);
});

it('replaces only the refund and revision on a newer revision and keeps the sale identity', async () => {
  const revision1 = saleEvent(SALE);
  await deliver(revision1);
  await deliver(saleEvent(SALE, { revision: 2, refundedAmount: '10.000' }));
  const rows = await saleRow(SALE);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    pricePaid: '30.000',
    refundedAmount: '10.000',
    revision: 2,
    sellerEmployeeId: A.employee,
    branchId: A.branch,
    businessDate: '2026-11-01',
  });
});

it('treats an equal or older revision as a no-op and still marks the event', async () => {
  await deliver(saleEvent(SALE, { revision: 2, refundedAmount: '10.000' }));
  await deliver(saleEvent(SALE, { revision: 2, refundedAmount: '10.000', id: ids.newId() }));
  await deliver(saleEvent(SALE, { id: ids.newId() }));
  const rows = await saleRow(SALE);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ refundedAmount: '10.000', revision: 2 });
  expect((await marks()).length).toBe(3);
});

it('keys the row by the sale id and never by the event id', async () => {
  await deliver(saleEvent(SALE));
  await deliver(saleEvent(SALE, { id: ids.newId(), revision: 3, refundedAmount: '30.000' }));
  expect((await saleRow(SALE)).length).toBe(1);
});

it('returns a reviewed month to draft in the same transaction (D-5)', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'REVIEWED' });
  await deliver(saleEvent(SALE));
  const [statement] = await owner`SELECT status FROM commission_statements
    WHERE company_id=${A.company} AND period='2026-11'`;
  expect(statement).toMatchObject({ status: 'DRAFT' });
  expect((await saleRow(SALE)).length).toBe(1);
});

it('refuses an approved month before any write: no row, no mark, no correction, no block', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'APPROVED' });
  const event = saleEvent(SALE);
  expect(await deliver(event)).toMatchObject({ delivered: false });
  expect(failures.get(event.id)).toBe('COMMISSION_PERIOD_CLOSED');
  expect(await saleRow(SALE)).toHaveLength(0);
  expect((await marks()).length).toBe(0);
  const corrections = await owner`SELECT 1 FROM commission_corrections`;
  const blocks = await owner`SELECT 1 FROM commission_blocked_corrections`;
  expect(corrections).toHaveLength(0);
  expect(blocks).toHaveLength(0);
});

it.each([
  {
    name: 'a refund above the price',
    payload: { refunded_amount: '30.001' },
    reason: 'REFUND_ABOVE_PRICE',
  },
  {
    name: 'an envelope naming another sale',
    aggregateId: OTHER_COMMISSION_IDS.service,
    reason: 'AGGREGATE_MISMATCH',
  },
  {
    name: 'an aggregate type that is not a package entitlement',
    aggregateType: 'service_session',
    reason: 'AGGREGATE_MISMATCH',
  },
])('refuses $name with COMMISSION_SALE_INPUT_INVALID and writes nothing', async (entry) => {
  const event = saleEvent(SALE, {
    payloadOverrides: entry.payload,
    aggregateId: entry.aggregateId,
    aggregateType: entry.aggregateType,
  });
  expect(await deliver(event)).toMatchObject({ delivered: false });
  expect(failures.get(event.id)).toBe('COMMISSION_SALE_INPUT_INVALID');
  expect(await saleRow(SALE)).toHaveLength(0);
  expect((await marks()).length).toBe(0);
});

it('refuses a later revision that names another business and never moves the row', async () => {
  await deliver(saleEvent(SALE));
  const moved = saleEvent(SALE, {
    businessId: OTHER_COMMISSION_IDS.business,
    revision: 2,
  });
  await deliver(moved);
  const rows = await saleRow(SALE);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ businessId: A.business, revision: 1 });
});

it('throws the sale input error out of the handler inside the tenant transaction', async () => {
  await db.withTenant(A.company, (tx) => {
    const sales = new ProjectPackageSale(
      createCommissionSaleProjectionScope(tx, fakeBusinessTimeZone(A.business), ids),
      clock,
      ids,
    );
    const useCases = {
      lines: null,
      tips: null,
      salary: null,
      sales,
    } as unknown as CommissionInputUseCases;
    return expect(
      onCommissionInputEvent(
        useCases,
        saleEvent(SALE, { payloadOverrides: { refunded_amount: '30.001' } }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'COMMISSION_SALE_INPUT_INVALID' }));
  });
  expect(await saleRow(SALE)).toHaveLength(0);
});

/** مستهلك تعيد فتح الشهور فيه أن تفشل بعد كتابة الصف؛ CM-22a على البيع. */
function failingReopenConsumer(): OutboxConsumer {
  return {
    id: consumer.id,
    eventTypes: consumer.eventTypes,
    handle: async (tx, event) => {
      const sales = new ProjectPackageSale(
        {
          ...createCommissionSaleProjectionScope(tx, fakeBusinessTimeZone(A.business), ids),
          reopenReviewed: async () => {
            throw new Error('injected reopen failure');
          },
        },
        clock,
        ids,
      );
      const useCases = { lines: null, tips: null, salary: null, sales } as unknown as CommissionInputUseCases;
      await onCommissionInputEvent(useCases, event);
    },
  };
}

it('leaves neither row nor mark when a failure follows the write; a redelivery projects once', async () => {
  const failing = createDeliverer(db, [failingReopenConsumer()], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const event = saleEvent(SALE);
  await failing(event);
  expect(await saleRow(SALE)).toHaveLength(0);
  expect((await marks()).length).toBe(0);

  await deliver(event);
  expect((await saleRow(SALE)).length).toBe(1);
  expect((await marks()).length).toBe(1);
});
