import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const businessTimeZone = fakeBusinessTimeZone(A.business);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

function deliverAt(now: string, event: ClaimedEvent) {
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock: { now: () => new Date(now) },
    businessTimeZone,
  });
  return createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
}

const recorded = (businessDate: string, row: Record<string, unknown> = {}) =>
  commissionLineEvent(A, ids, 'ServiceSessionRecorded', { ...row, businessDate });
const moved = (businessDate: string, row: Record<string, unknown> = {}) =>
  commissionLineEvent(A, ids, 'ServiceLineChanged', { ...row, businessDate, revision: 2 });
const followPlan = { ruleSnapshot: { kind: 'FOLLOW_PLAN' } } as const;
const heads = () => owner`SELECT * FROM commission_line_heads ORDER BY line_id`;
const lines = () => owner`SELECT * FROM commission_lines ORDER BY line_id,employee_id`;
const marks = () =>
  owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

const closedRemovalMonths = [
  { status: 'APPROVED', from: '2027-01', to: '2027-02', now: '2027-03-05T09:00:00Z' },
  { status: 'PAID', from: '2027-04', to: '2027-05', now: '2027-06-05T09:00:00Z' },
] as const;

it.each(closedRemovalMonths)(
  'a $status removal month delivers the moved line without a frozen correction',
  async ({ status, from, to, now }) => {
    expect(await deliverAt(now, recorded(`${from}-15`, followPlan))).toEqual({ delivered: true });
    await walkCommissionStatement(db, { tenant: A, period: from, ids, to: status });
    expect(await deliverAt(now, moved(`${to}-15`, followPlan))).toEqual({ delivered: true });
    expect(await heads()).toHaveLength(1);
    expect((await heads())[0]).toMatchObject({ revision: 2, period: to });
    expect(await lines()).toHaveLength(1);
    expect((await lines())[0]).toMatchObject({ period: to, net: '10.001' });
    expect(await owner`SELECT * FROM commission_corrections`).toEqual([]);
    expect(await marks()).toHaveLength(2);
  },
);

it('an approved addition month without a plan version is consumed with one open blocked row', async () => {
  const movedEvent = moved('2027-08-15', followPlan);
  expect(await deliverAt('2027-09-05T09:00:00Z', recorded('2027-07-15', followPlan))).toEqual({
    delivered: true,
  });
  await walkCommissionStatement(db, { tenant: A, period: '2027-08', ids });
  expect(await deliverAt('2027-09-05T09:00:00Z', movedEvent)).toEqual({ delivered: true });
  expect(await heads()).toHaveLength(1);
  expect((await heads())[0]).toMatchObject({ revision: 2, period: '2027-08' });
  expect(await lines()).toHaveLength(1);
  expect(await marks()).toHaveLength(2);
  expect(
    await owner`SELECT code,source_period,first_event_id,resolved_at FROM commission_blocked_corrections`,
  ).toEqual([
    { code: 'NO_PLAN', source_period: '2027-08', first_event_id: movedEvent.id, resolved_at: null },
  ]);
});

it('a move between two reviewed months reopens both months to draft', async () => {
  expect(await deliverAt('2027-12-05T09:00:00Z', recorded('2027-10-15'))).toEqual({
    delivered: true,
  });
  await walkCommissionStatement(db, { tenant: A, period: '2027-10', ids, to: 'REVIEWED' });
  await walkCommissionStatement(db, { tenant: A, period: '2027-11', ids, to: 'REVIEWED' });
  expect(await deliverAt('2027-12-05T09:00:00Z', moved('2027-11-15'))).toEqual({ delivered: true });
  expect(
    await owner`SELECT period,status,reviewed_fingerprint,reviewed_statement_fingerprint,
    reviewed_by,reviewed_membership_id,reviewed_at FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business}
      AND period IN ('2027-10','2027-11') ORDER BY period`,
  ).toEqual([
    {
      period: '2027-10',
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    },
    {
      period: '2027-11',
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    },
  ]);
  expect((await heads())[0]).toMatchObject({ revision: 2, period: '2027-11' });
  expect((await lines())[0]).toMatchObject({ period: '2027-11' });
});
