import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { commissionSaleEvent } from './commission-tip-salary-events.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { recordCommissionFailureCodes } from '../index.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: ReturnType<typeof createDeliverer>;
const failures = new Map<string, string>();
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
/** ساعة قابلة للتحريك: كل سيناريو بيفرض شهره الحالي. */
const now = { at: new Date('2026-12-05T09:00:00Z') };
const clock = { now: () => now.at };

const SALE = '01970000-0000-7000-8000-000000000401';
const OTHER_SALE = '01970000-0000-7000-8000-000000000402';

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
  deliver = createDeliverer(
    db,
    [recordCommissionFailureCodes(consumer, failures)],
    createLogger('silent'),
    {
      knownEventTypes: consumer.eventTypes,
    },
  );
  // الخطة بتسعّر بيع الباقة بنسبة عشرة بالمئة من أول شهر تاريخي، فبيع بثلاثين دينار بيساوي ثلاثة دنانير.
  await db.withTenant(A.company, (tx) =>
    insertCommissionPlanVersion(tx, A, ids, {
      effectiveFrom: '2024-01-01',
      plan: {
        base: { enabled: false },
        tiers: { enabled: false },
        package_sale: { enabled: true, calc: { kind: 'PCT', bps: 1000 } },
      },
    }),
  );
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  failures.clear();
  now.at = new Date('2026-12-05T09:00:00Z');
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_sales`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const saleEvent = (overrides: Record<string, unknown> = {}) =>
  commissionSaleEvent(A, ids, {
    saleId: SALE,
    businessDate: '2024-01-15',
    soldAt: '2024-01-15T09:00:00Z',
    ...overrides,
  });

const statements = () =>
  owner`SELECT period, status FROM commission_statements
    WHERE company_id=${A.company} ORDER BY period`;

const saleRows = () =>
  owner`SELECT sale_id AS "saleId", period FROM commission_sales
    WHERE company_id=${A.company} ORDER BY sale_id`;

const ledger = () =>
  owner`SELECT kind, amount::text AS amount, source_period AS "sourcePeriod",
    target_period AS "targetPeriod" FROM commission_corrections
    WHERE company_id=${A.company} ORDER BY source_period, kind`;

const marks = () =>
  owner`SELECT event_id FROM consumed_events
    WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;

it('creates only the historical month of an open historical sale', async () => {
  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });

  expect(await statements()).toEqual([{ period: '2024-01', status: 'DRAFT' }]);
  expect(await saleRows()).toEqual([{ saleId: SALE, period: '2024-01' }]);
});

it('creates only the retained month of an extreme historical sale', async () => {
  const event = saleEvent({ businessDate: '0001-01-15', soldAt: '0001-01-15T00:00:00Z' });
  expect(await deliver(event)).toMatchObject({ delivered: true });

  expect(await statements()).toEqual([{ period: '0001-01', status: 'DRAFT' }]);
  expect(await saleRows()).toEqual([{ saleId: SALE, period: '0001-01' }]);
});

it('walks a closed historical month to its first open target and publishes the correction there', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2024-01', ids, to: 'APPROVED' });
  await walkCommissionStatement(db, { tenant: A, period: '2024-02', ids, to: 'REVIEWED' });

  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });

  // القفل وقف عند أول شهر مفتوح بعد الشهر المقفول، فمفيش كشوف للشهور اللي بينه وبين الشهر الحالي.
  expect(await statements()).toEqual([
    { period: '2024-01', status: 'APPROVED' },
    { period: '2024-02', status: 'REVIEWED' },
    { period: '2024-03', status: 'DRAFT' },
  ]);
  expect(await ledger()).toEqual([
    { kind: 'SALE', amount: '3.000', sourcePeriod: '2024-01', targetPeriod: '2024-03' },
  ]);
});

it('refuses a closed historical month with no open target inside the current month', async () => {
  now.at = new Date('2024-01-20T09:00:00Z');
  await walkCommissionStatement(db, { tenant: A, period: '2024-01', ids, to: 'APPROVED' });
  const event = saleEvent();

  expect(await deliver(event)).toMatchObject({ delivered: false });

  expect(failures.get(event.id)).toBe('COMMISSION_PERIOD_CLOSED');
  expect(await statements()).toEqual([{ period: '2024-01', status: 'APPROVED' }]);
  expect(await saleRows()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('keeps only the months of the valid sales in a mixed replay batch', async () => {
  const invalid = saleEvent({ saleId: OTHER_SALE, refundedAmount: '30.001' });

  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });
  expect(await deliver(invalid)).toMatchObject({ delivered: false });
  expect(failures.get(invalid.id)).toBe('COMMISSION_SALE_INPUT_INVALID');
  expect(
    await deliver(
      saleEvent({ saleId: OTHER_SALE, businessDate: '2025-06-15', soldAt: '2025-06-15T09:00:00Z' }),
    ),
  ).toMatchObject({ delivered: true });

  expect(await statements()).toEqual([
    { period: '2024-01', status: 'DRAFT' },
    { period: '2025-06', status: 'DRAFT' },
  ]);
});
