import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
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
  commissionTipEvent,
  type CommissionTipEventOverrides,
} from './commission-tip-salary-events.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;
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
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const tipEvent = (overrides: CommissionTipEventOverrides = {}) =>
  commissionTipEvent(A, ids, overrides);
const heads = () => owner`SELECT * FROM commission_tip_heads ORDER BY session_id`;
const tips = () => owner`SELECT * FROM commission_tips ORDER BY employee_id,method`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

it('regression: consumer keeps id commissions.project-inputs and five event types', () => {
  expect(consumer.id).toBe('commissions.project-inputs');
  expect(consumer.eventTypes).toEqual([
    'ServiceSessionRecorded',
    'ServiceSessionLinesAdded',
    'ServiceLineChanged',
    'SessionTipsChanged',
    'SalaryChanged',
  ]);
});

it('CM-18 rev 1 projects CASH and CARD rows separately with exact amounts and one mark', async () => {
  const sessionId = ids.newId();
  const event = tipEvent({
    sessionId,
    tips: [
      { employee_id: A.employee, method: 'CASH', amount: '12.500' },
      { employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '25.000' },
    ],
  });
  expect(await deliver(event)).toEqual({ delivered: true });
  const storedHeads = await heads();
  expect(storedHeads).toHaveLength(1);
  expect(storedHeads[0]).toMatchObject({
    session_id: sessionId,
    business_id: A.business,
    branch_id: A.branch,
    revision: 1,
    period: '2026-11',
  });
  const storedTips = await tips();
  expect(storedTips).toHaveLength(2);
  expect(storedTips.map((r) => [r.employee_id, r.method, r.amount])).toEqual([
    [A.employee, 'CASH', '12.500'],
    [COMMISSION_LINE_IDS.secondEmployee, 'CARD', '25.000'],
  ]);
  expect(await marks()).toHaveLength(1);
});

it('CM-18 rev 2 replaces all rows; rev 1 after rev 2 is no-op that commits mark; equal revision no-ops', async () => {
  const sessionId = ids.newId();
  const rev1 = tipEvent({
    sessionId,
    revision: 1,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '10.000' }],
  });
  const rev2 = tipEvent({
    sessionId,
    revision: 2,
    tips: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '20.000' }],
  });
  await deliver(rev1);
  expect(await deliver(rev2)).toEqual({ delivered: true });
  expect((await heads())[0]).toMatchObject({ revision: 2 });
  expect(await tips()).toMatchObject([
    { employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '20.000' },
  ]);
  expect(await marks()).toHaveLength(2);

  const staleRev1 = tipEvent({
    sessionId,
    revision: 1,
    tips: [{ employee_id: A.employee, method: 'CASH', amount: '10.000' }],
  });
  expect(await deliver(staleRev1)).toEqual({ delivered: true });
  expect((await heads())[0]).toMatchObject({ revision: 2 });
  expect(await marks()).toHaveLength(3);

  const rev2DifferentEvent = tipEvent({
    sessionId,
    revision: 2,
    tips: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, method: 'CARD', amount: '20.000' }],
  });
  expect(await deliver(rev2DifferentEvent)).toEqual({ delivered: true });
  expect((await heads())[0]).toMatchObject({ revision: 2 });
  expect(await marks()).toHaveLength(4);
});

it('CM-18 empty rev 3 deletes rows but keeps head, then stale rev 2 cannot resurrect rows', async () => {
  const sessionId = ids.newId();
  await deliver(
    tipEvent({
      sessionId,
      revision: 2,
      tips: [{ employee_id: A.employee, method: 'CARD', amount: '15.000' }],
    }),
  );
  expect(await deliver(tipEvent({ sessionId, revision: 3, tips: [] }))).toEqual({
    delivered: true,
  });
  expect((await heads())[0]).toMatchObject({ revision: 3 });
  expect(await tips()).toEqual([]);
  expect(await marks()).toHaveLength(2);

  await deliver(
    tipEvent({
      sessionId,
      revision: 2,
      tips: [{ employee_id: A.employee, method: 'CARD', amount: '15.000' }],
    }),
  );
  expect((await heads())[0]).toMatchObject({ revision: 3 });
  expect(await tips()).toEqual([]);
  expect(await marks()).toHaveLength(3);
});

it('CM-18 duplicate event id is skipped with one mark', async () => {
  const event = tipEvent();
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await marks()).toHaveLength(1);
});

it('malformed amount or aggregate mismatch fails delivery with no head, rows, or mark', async () => {
  const malformed = tipEvent({
    payloadOverrides: {
      tips: [{ employee_id: A.employee, method: 'CARD', amount: '1.5' }],
    },
  });
  expect(await deliver(malformed)).toMatchObject({ delivered: false });
  expect(await heads()).toEqual([]);
  expect(await tips()).toEqual([]);
  expect(await marks()).toEqual([]);

  const mismatch = tipEvent({ aggregateType: 'employee' });
  expect(await deliver(mismatch)).toMatchObject({ delivered: false });
  expect(await heads()).toEqual([]);
  expect(await tips()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('business change on a newer revision throws TIP_IDENTITY_CHANGED with no write', async () => {
  const sessionId = ids.newId();
  await deliver(tipEvent({ sessionId, revision: 1 }));
  const conflicting = tipEvent({
    sessionId,
    revision: 2,
    businessId: OTHER_COMMISSION_IDS.business,
    branchId: OTHER_COMMISSION_IDS.branch,
  });
  expect(await deliver(conflicting)).toMatchObject({ delivered: false });
  expect((await heads())[0]).toMatchObject({ revision: 1, business_id: A.business });
  expect(await marks()).toHaveLength(1);
});

it('closed guard: affected month APPROVED refuses delivery before head, rows or mark', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'APPROVED' });
  expect(await deliver(tipEvent({ businessDate: '2026-11-15' }))).toMatchObject({
    delivered: false,
  });
  expect(await heads()).toEqual([]);
  expect(await tips()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('candidate-only later APPROVED month does not block delivery of an earlier affected month', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2026-12', ids, to: 'APPROVED' });
  expect(await deliver(tipEvent({ businessDate: '2026-10-15' }))).toEqual({ delivered: true });
  expect((await heads())[0]).toMatchObject({ period: '2026-10' });
  expect(await tips()).toHaveLength(1);
  const [candidate] = await owner`SELECT status FROM commission_statements WHERE period='2026-12'`;
  expect(candidate?.status).toBe('APPROVED');
});

it('affected REVIEWED reopens to DRAFT and stale event does not reopen REVIEWED', async () => {
  const sessionId = ids.newId();
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'REVIEWED' });
  expect(await deliver(tipEvent({ sessionId, businessDate: '2026-11-15', revision: 2 }))).toEqual({
    delivered: true,
  });
  expect(
    await owner`SELECT status,reviewed_at,reviewed_by,reviewed_fingerprint
      FROM commission_statements WHERE period='2026-11'`,
  ).toEqual([
    { status: 'DRAFT', reviewed_at: null, reviewed_by: null, reviewed_fingerprint: null },
  ]);

  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'REVIEWED' });
  await deliver(tipEvent({ sessionId, businessDate: '2026-11-15', revision: 1 }));
  const [stmt] = await owner`SELECT status FROM commission_statements WHERE period='2026-11'`;
  expect(stmt?.status).toBe('REVIEWED');
});

it('atomicity: failure after execution rolls back effect and mark, retry commits once', async () => {
  const event = tipEvent();
  const failingConsumer: OutboxConsumer = {
    id: consumer.id,
    eventTypes: consumer.eventTypes,
    handle: async (tx, claimed) => {
      await consumer.handle(tx, claimed);
      throw new Error('injected post-handle crash');
    },
  };
  const failingDeliver = createDeliverer(db, [failingConsumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  expect(await failingDeliver(event)).toMatchObject({ delivered: false });
  expect(await heads()).toEqual([]);
  expect(await tips()).toEqual([]);
  expect(await marks()).toEqual([]);

  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await heads()).toHaveLength(1);
  expect(await tips()).toHaveLength(1);
  expect(await marks()).toHaveLength(1);
});

it('tenant isolation: company A envelope carrying company B ids fails FK with no write', async () => {
  const crossTenant = tipEvent({
    businessId: B.business,
    branchId: B.branch,
    tips: [{ employee_id: B.employee, method: 'CARD', amount: '10.000' }],
  });
  expect(await deliver(crossTenant)).toMatchObject({ delivered: false });
  expect(await heads()).toEqual([]);
  expect(await tips()).toEqual([]);
  expect(await marks()).toEqual([]);
});
