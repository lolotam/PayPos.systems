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
  OTHER_COMMISSION_IDS,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import {
  commissionSalaryEvent,
  type CommissionSalaryEventOverrides,
} from './commission-tip-salary-events.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
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
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`UPDATE employees SET deleted_at = NULL WHERE id = ${A.employee}`;
  await owner`UPDATE businesses SET created_at = '2025-01-01T00:00:00Z' WHERE company_id = ${A.company} AND id = ${A.business}`;
});

const salaryEvent = (overrides: CommissionSalaryEventOverrides = {}) =>
  commissionSalaryEvent(A, ids, overrides);
const salaries = () =>
  owner`SELECT business_id AS "businessId", employee_id AS "employeeId",
    effective_from::text AS "effectiveFrom", amount::text AS amount, revision
    FROM commission_salaries ORDER BY effective_from, revision`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

it('CM-19 same-date newer revision replaces amount; older no-ops; two dates coexist', async () => {
  const rev1 = salaryEvent({ effectiveFrom: '2026-04-01', amount: '500.000', revision: 1 });
  const rev2 = salaryEvent({ effectiveFrom: '2026-04-01', amount: '600.000', revision: 2 });
  const laterDate = salaryEvent({ effectiveFrom: '2026-07-01', amount: '700.000', revision: 1 });

  expect(await deliver(rev1)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { effectiveFrom: '2026-04-01', amount: '500.000', revision: 1 },
  ]);

  expect(await deliver(rev2)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { effectiveFrom: '2026-04-01', amount: '600.000', revision: 2 },
  ]);

  const staleRev1 = salaryEvent({ effectiveFrom: '2026-04-01', amount: '500.000', revision: 1 });
  expect(await deliver(staleRev1)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { effectiveFrom: '2026-04-01', amount: '600.000', revision: 2 },
  ]);

  expect(await deliver(laterDate)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { effectiveFrom: '2026-04-01', amount: '600.000', revision: 2 },
    { effectiveFrom: '2026-07-01', amount: '700.000', revision: 1 },
  ]);
  expect(await marks()).toHaveLength(4);
});

it('CM-19 0.000 and 99999999999.999 round-trip exactly in amount::text', async () => {
  await deliver(salaryEvent({ effectiveFrom: '2026-01-01', amount: '0.000' }));
  await deliver(salaryEvent({ effectiveFrom: '2026-02-01', amount: '99999999999.999' }));
  const rows = await salaries();
  expect(rows.map((r) => [r.effectiveFrom, r.amount])).toEqual([
    ['2026-01-01', '0.000'],
    ['2026-02-01', '99999999999.999'],
  ]);
});

it('FR-042 entry between two dates reopens only REVIEWED months whose last day is in range', async () => {
  await deliver(salaryEvent({ effectiveFrom: '2026-01-01', amount: '400.000', revision: 1 }));
  await deliver(salaryEvent({ effectiveFrom: '2026-07-01', amount: '600.000', revision: 1 }));

  for (const m of ['01', '02', '03', '04', '05', '06', '07', '08']) {
    await walkCommissionStatement(db, { tenant: A, period: `2026-${m}`, ids, to: 'REVIEWED' });
  }

  const middle = salaryEvent({ effectiveFrom: '2026-04-01', amount: '500.000', revision: 1 });
  expect(await deliver(middle)).toEqual({ delivered: true });

  const statements = await owner`SELECT period, status FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business}
      AND period BETWEEN '2026-01' AND '2026-08' ORDER BY period`;

  expect(statements).toEqual([
    { period: '2026-01', status: 'REVIEWED' },
    { period: '2026-02', status: 'REVIEWED' },
    { period: '2026-03', status: 'REVIEWED' },
    { period: '2026-04', status: 'DRAFT' },
    { period: '2026-05', status: 'DRAFT' },
    { period: '2026-06', status: 'DRAFT' },
    { period: '2026-07', status: 'REVIEWED' },
    { period: '2026-08', status: 'REVIEWED' },
  ]);
});

it('future-only entry writes the salary row and creates no statement row', async () => {
  const future = salaryEvent({ effectiveFrom: '2027-03-01', amount: '800.000' });
  expect(await deliver(future)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([{ effectiveFrom: '2027-03-01', amount: '800.000' }]);
  expect(await owner`SELECT * FROM commission_statements`).toEqual([]);
  expect(await marks()).toHaveLength(1);
});

it('D2 floor: salary dated years before business created_at creates statements only from start month', async () => {
  await owner`UPDATE businesses SET created_at = '2026-09-15T00:00:00Z' WHERE company_id = ${A.company} AND id = ${A.business}`;

  const oldSalary = salaryEvent({ effectiveFrom: '2024-01-01', amount: '350.000' });
  expect(await deliver(oldSalary)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([{ effectiveFrom: '2024-01-01', amount: '350.000' }]);

  const createdPeriods = await owner<{ period: string }[]>`
    SELECT period FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business} ORDER BY period`;
  expect(createdPeriods.map((p) => p.period)).toEqual([
    '2026-09',
    '2026-10',
    '2026-11',
    '2026-12',
  ]);
  expect(createdPeriods.some((p) => p.period < '2026-09')).toBe(false);
});

it('CM-25 legacy event without business_id applies to active employee business', async () => {
  const legacy = salaryEvent({ businessId: null });
  expect(await deliver(legacy)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { businessId: A.business, employeeId: A.employee, amount: '500.000' },
  ]);
  expect(await marks()).toHaveLength(1);
});

it('CM-25 legacy event applies to soft-deleted employee through owner connection', async () => {
  await owner`UPDATE employees SET deleted_at = now() WHERE id = ${A.employee}`;
  const legacy = salaryEvent({ businessId: null });
  expect(await deliver(legacy)).toEqual({ delivered: true });
  expect(await salaries()).toMatchObject([
    { businessId: A.business, employeeId: A.employee, amount: '500.000' },
  ]);
  expect(await marks()).toHaveLength(1);
});

it('legacy event for an unknown employee throws CommissionEmployeeBusinessMissingError', async () => {
  const unknownEmployeeId = ids.newId();
  const legacyUnknown = salaryEvent({
    employeeId: unknownEmployeeId,
    businessId: null,
    aggregateId: unknownEmployeeId,
  });
  expect(await deliver(legacyUnknown)).toMatchObject({ delivered: false });
  expect(await salaries()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('redelivery of the same event id after success does nothing', async () => {
  const event = salaryEvent();
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await salaries()).toHaveLength(1);
  expect(await marks()).toHaveLength(1);
});

it('a present business_id of another business in the same company fails FK with nothing written', async () => {
  const wrongBusiness = salaryEvent({ businessId: OTHER_COMMISSION_IDS.business });
  expect(await deliver(wrongBusiness)).toMatchObject({ delivered: false });
  expect(await salaries()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('closed guard: affected month APPROVED refuses delivery before row or mark', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'APPROVED' });
  expect(await deliver(salaryEvent({ effectiveFrom: '2026-11-01' }))).toMatchObject({
    delivered: false,
  });
  expect(await salaries()).toEqual([]);
  expect(await marks()).toEqual([]);
});
