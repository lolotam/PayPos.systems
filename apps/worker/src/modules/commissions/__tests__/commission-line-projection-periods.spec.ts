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
import { CommissionBusinessMissingError } from '../domain/errors.ts';
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

const event = (row: Record<string, unknown> = {}) =>
  commissionLineEvent(A, ids, 'ServiceSessionRecorded', row);
const projectionCount = async () => ({
  heads: await owner`SELECT line_id FROM commission_line_heads`,
  lines: await owner`SELECT line_id FROM commission_lines`,
  marks: await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`,
});

const closedAffectedMonths = [
  { status: 'APPROVED', period: '2027-01', now: '2027-03-05T09:00:00Z' },
  { status: 'PAID', period: '2027-02', now: '2027-03-05T09:00:00Z' },
] as const;

it.each(closedAffectedMonths)(
  'an $status affected month refuses delivery before rows or a mark',
  async ({ status, period, now }) => {
    await walkCommissionStatement(db, { tenant: A, period, ids, to: status });
    const outcome = await deliverAt(now, event({ businessDate: `${period}-15` }));
    expect(outcome).toMatchObject({ delivered: false });
    expect(await projectionCount()).toEqual({ heads: [], lines: [], marks: [] });
    expect(await owner`SELECT status FROM commission_statements WHERE period=${period}`)
      .toEqual([{ status }]);
  },
);

it('REVIEWED affected month reopens while a later REVIEWED candidate stays reviewed', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2027-04', ids, to: 'REVIEWED' });
  await walkCommissionStatement(db, { tenant: A, period: '2027-05', ids, to: 'REVIEWED' });
  expect(await deliverAt('2027-06-05T09:00:00Z', event({ businessDate: '2027-04-15' })))
    .toEqual({ delivered: true });
  expect(await owner`SELECT status,reviewed_fingerprint,reviewed_statement_fingerprint,
    reviewed_by,reviewed_membership_id,reviewed_at FROM commission_statements WHERE period='2027-04'`)
    .toEqual([{
      status: 'DRAFT', reviewed_fingerprint: null, reviewed_statement_fingerprint: null,
      reviewed_by: null, reviewed_membership_id: null, reviewed_at: null,
    }]);
  const [candidate] = await owner`SELECT status,reviewed_by FROM commission_statements WHERE period='2027-05'`;
  expect(candidate?.status).toBe('REVIEWED');
  expect(candidate?.reviewed_by).not.toBeNull();
});

it('candidate months through the fixed current business month receive DRAFT rows', async () => {
  expect(await deliverAt('2027-09-05T09:00:00Z', event({ businessDate: '2027-07-15' })))
    .toEqual({ delivered: true });
  expect(await owner`SELECT period,status FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business}
      AND period BETWEEN '2027-07' AND '2027-09' ORDER BY period`)
    .toEqual([
      { period: '2027-07', status: 'DRAFT' },
      { period: '2027-08', status: 'DRAFT' },
      { period: '2027-09', status: 'DRAFT' },
    ]);
});

it('a missing business fails with the named error before any write', async () => {
  const missing = event({ businessId: '01920000-0000-7000-8000-00000000dead' });
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock: { now: () => new Date('2027-10-05T09:00:00Z') },
    businessTimeZone,
  });
  await expect(db.withTenant(A.company, (tx) => consumer.handle(tx, missing)))
    .rejects.toBeInstanceOf(CommissionBusinessMissingError);
  expect(await deliverAt('2027-10-05T09:00:00Z', missing)).toMatchObject({ delivered: false });
  expect(await projectionCount()).toEqual({ heads: [], lines: [], marks: [] });
});

it('an approved candidate month is not classified and stays approved', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2027-12', ids });
  expect(await deliverAt('2028-01-05T09:00:00Z', event({ businessDate: '2027-11-15' })))
    .toEqual({ delivered: true });
  const projection = await projectionCount();
  expect(projection.heads).toHaveLength(1);
  expect(projection.lines).toHaveLength(1);
  expect(projection.marks).toHaveLength(1);
  expect(await owner`SELECT period,status FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business}
      AND period IN ('2027-11','2027-12') ORDER BY period`)
    .toEqual([
      { period: '2027-11', status: 'DRAFT' },
      { period: '2027-12', status: 'APPROVED' },
    ]);
});
