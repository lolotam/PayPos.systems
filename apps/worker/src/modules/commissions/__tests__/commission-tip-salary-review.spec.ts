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
import { expectLockBeforeFirstWrite } from '../../../../../../packages/db/test/statement-lock-order.ts';
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
  commissionTipEvent,
  type CommissionSalaryEventOverrides,
  type CommissionTipEventOverrides,
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
  await owner`DELETE FROM commission_tips`;
  await owner`DELETE FROM commission_tip_heads`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`UPDATE employees SET deleted_at = NULL WHERE id = ${A.employee}`;
  await owner`UPDATE businesses SET created_at = '2025-01-01T00:00:00Z' WHERE company_id = ${A.company} AND id = ${A.business}`;
});

const salaryEvent = (overrides: CommissionSalaryEventOverrides = {}) =>
  commissionSalaryEvent(A, ids, overrides);
const tipEvent = (overrides: CommissionTipEventOverrides = {}) =>
  commissionTipEvent(A, ids, overrides);
const salaries = () =>
  owner`SELECT business_id AS "businessId", employee_id AS "employeeId",
    effective_from::text AS "effectiveFrom", amount::text AS amount, revision
    FROM commission_salaries ORDER BY effective_from, revision`;
const heads = () => owner`SELECT * FROM commission_tip_heads ORDER BY session_id`;
const tips = () => owner`SELECT * FROM commission_tips ORDER BY employee_id,method`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

it('stale revision 1 and equal revision 2 with different business no-op and commit mark for salary', async () => {
  const rev2 = salaryEvent({
    effectiveFrom: '2026-04-01',
    amount: '600.000',
    revision: 2,
  });
  expect(await deliver(rev2)).toEqual({ delivered: true });

  const staleOther = salaryEvent({
    businessId: OTHER_COMMISSION_IDS.business,
    effectiveFrom: '2026-04-01',
    amount: '500.000',
    revision: 1,
  });
  expect(await deliver(staleOther)).toEqual({ delivered: true });

  const equalOther = salaryEvent({
    businessId: OTHER_COMMISSION_IDS.business,
    effectiveFrom: '2026-04-01',
    amount: '500.000',
    revision: 2,
  });
  expect(await deliver(equalOther)).toEqual({ delivered: true });

  expect(await salaries()).toMatchObject([
    {
      businessId: A.business,
      employeeId: A.employee,
      effectiveFrom: '2026-04-01',
      amount: '600.000',
      revision: 2,
    },
  ]);
  expect(await marks()).toHaveLength(3);
});

it('stale revision 1 and equal revision 2 with different business/branch no-op and commit mark for tips', async () => {
  const sessionId = ids.newId();
  const rev2 = tipEvent({
    sessionId,
    revision: 2,
    tips: [{ employee_id: A.employee, method: 'CARD', amount: '20.000' }],
  });
  expect(await deliver(rev2)).toEqual({ delivered: true });

  const staleOther = tipEvent({
    sessionId,
    revision: 1,
    businessId: OTHER_COMMISSION_IDS.business,
    branchId: OTHER_COMMISSION_IDS.branch,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '10.000' }],
  });
  expect(await deliver(staleOther)).toEqual({ delivered: true });

  const equalOther = tipEvent({
    sessionId,
    revision: 2,
    businessId: OTHER_COMMISSION_IDS.business,
    branchId: OTHER_COMMISSION_IDS.branch,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '10.000' }],
  });
  expect(await deliver(equalOther)).toEqual({ delivered: true });

  const storedHeads = await heads();
  expect(storedHeads).toHaveLength(1);
  expect(storedHeads[0]).toMatchObject({
    session_id: sessionId,
    business_id: A.business,
    branch_id: A.branch,
    revision: 2,
  });

  const storedTips = await tips();
  expect(storedTips).toMatchObject([
    {
      session_id: sessionId,
      employee_id: A.employee,
      method: 'CARD',
      amount: '20.000',
    },
  ]);
  expect(await marks()).toHaveLength(3);
});

it('FR-004 tips writer locks the statement period before writing to tip tables', async () => {
  const period = '2026-11';
  await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  const event = tipEvent({ businessDate: `${period}-15` });

  await expectLockBeforeFirstWrite({
    db,
    ownerUrl: testDb.ownerUrl,
    companyId: A.company,
    businessId: A.business,
    period,
    ids,
    inputTables: ['commission_tip_heads', 'commission_tips'],
    writer: (tx) => consumer.handle(tx, event),
  });
});

it('FR-004 salary writer locks the statement period before writing to salary table', async () => {
  const period = '2026-11';
  await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  const event = salaryEvent({ effectiveFrom: `${period}-01`, amount: '500.000' });

  await expectLockBeforeFirstWrite({
    db,
    ownerUrl: testDb.ownerUrl,
    companyId: A.company,
    businessId: A.business,
    period,
    ids,
    inputTables: ['commission_salaries'],
    writer: (tx) => consumer.handle(tx, event),
  });
});
