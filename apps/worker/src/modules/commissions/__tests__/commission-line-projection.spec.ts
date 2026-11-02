import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { CommissionLineEventInvalidError } from '../domain/errors.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { createCommissionInputsConsumer } from '../index.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const businessTimeZone = fakeBusinessTimeZone(A.business);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  consumer = createCommissionInputsConsumer({
    ids,
    clock: { now: () => new Date('2026-12-05T09:00:00Z') },
    businessTimeZone,
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
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`DELETE FROM company_feature_overrides WHERE flag='commissions'`;
});

const event = (
  type: 'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged',
  row: Record<string, unknown> = {},
) => commissionLineEvent(A, ids, type, row);
const heads = () => owner`SELECT * FROM commission_line_heads ORDER BY line_id`;
const lines = () => owner`SELECT * FROM commission_lines ORDER BY line_id,employee_id`;
const marks = () => owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

it('CM-14 projects two lines and three performer rows with exact odd-mill shares and one mark', async () => {
  const recorded = event('ServiceSessionRecorded', {
    lines: [
      {
        lineId: COMMISSION_LINE_IDS.lineA,
        net: '10.001',
        performers: [
          { employee_id: A.employee, share_bps: 5000 },
          { employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 5000 },
        ],
      },
      {
        lineId: COMMISSION_LINE_IDS.lineB,
        net: '2.000',
        performers: [{ employee_id: COMMISSION_LINE_IDS.thirdEmployee, share_bps: 10000 }],
      },
    ],
  });
  expect(await deliver(recorded)).toEqual({ delivered: true });
  const storedHeads = await heads();
  expect(storedHeads).toHaveLength(2);
  expect(storedHeads.every((row) => row.customer_id === A.customer && row.service_id === A.service)).toBe(true);
  const storedLines = await lines();
  expect(storedLines).toHaveLength(3);
  const shared = storedLines.filter((row) => row.line_id === COMMISSION_LINE_IDS.lineA);
  expect(shared.map((row) => [row.employee_id, row.net_share])).toEqual([
    [A.employee, '5.001'],
    [COMMISSION_LINE_IDS.secondEmployee, '5.000'],
  ]);
  for (const lineId of [COMMISSION_LINE_IDS.lineA, COMMISSION_LINE_IDS.lineB]) {
    const rows = storedLines.filter((row) => row.line_id === lineId);
    const shares = rows.reduce((sum, row) => sum + BigInt(row.net_share.replace('.', '')), 0n);
    expect(shares).toBe(BigInt((rows[0]?.net as string).replace('.', '')));
  }
  expect(await marks()).toHaveLength(1);
});

it('CM-15 LinesAdded projects only its lines and redelivery adds nothing', async () => {
  await deliver(event('ServiceSessionRecorded'));
  const added = event('ServiceSessionLinesAdded', { lineId: COMMISSION_LINE_IDS.lineB });
  await deliver(added);
  expect(await heads()).toHaveLength(2);
  await deliver(added);
  expect(await heads()).toHaveLength(2);
  expect(await lines()).toHaveLength(2);
  expect(await marks()).toHaveLength(2);
});

it('CM-16 revision 2 wins over delayed revision 1 and both events are marked', async () => {
  const changed = event('ServiceLineChanged', {
    revision: 2,
    net: '20.000',
    previousNet: '10.001',
    changeKind: 'PRICE_DISCOUNT_EDIT',
  });
  await deliver(changed);
  await deliver(event('ServiceSessionRecorded', { net: '10.001' }));
  expect(await heads()).toHaveLength(1);
  expect((await heads())[0]).toMatchObject({ revision: 2 });
  expect(await lines()).toHaveLength(1);
  expect((await lines())[0]).toMatchObject({ net: '20.000', net_share: '20.000' });
  expect(await marks()).toHaveLength(2);
});

it('accepts a ServiceLineChanged snapshot without a change block', async () => {
  await deliver(event('ServiceLineChanged', { revision: 2, net: '11.000' }));
  expect((await heads())[0]).toMatchObject({ revision: 2 });
  expect((await lines())[0]).toMatchObject({ net: '11.000', net_share: '11.000' });
});

it('CM-17 cancellation and performer replacement carry status and remove the old performer', async () => {
  await deliver(event('ServiceSessionRecorded'));
  await deliver(event('ServiceLineChanged', { revision: 2, changeKind: 'LINE_CANCELLED' }));
  expect((await heads())[0]).toMatchObject({ status: 'CANCELLED' });
  const cancelled = await lines();
  expect(cancelled).toHaveLength(1);
  expect(cancelled.every((row) => row.status === 'CANCELLED')).toBe(true);
  await deliver(event('ServiceLineChanged', {
    revision: 3,
    changeKind: 'PERFORMERS_CHANGE',
    performers: [
      { employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 7000 },
      { employee_id: COMMISSION_LINE_IDS.thirdEmployee, share_bps: 3000 },
    ],
  }));
  expect(await lines()).toHaveLength(2);
  expect((await lines()).map((row) => [row.employee_id, row.share_bps, row.net_share])).toEqual([
    [COMMISSION_LINE_IDS.secondEmployee, 7000, '7.001'],
    [COMMISSION_LINE_IDS.thirdEmployee, 3000, '3.000'],
  ]);
  expect((await lines()).some((row) => row.employee_id === A.employee)).toBe(false);
});

it('CM-26 uses the event business_date for the period at the UTC month boundary', async () => {
  await deliver(event('ServiceSessionRecorded', {
    occurredAt: '2026-10-31T21:30:00.000Z',
    businessDate: '2026-11-01',
  }));
  expect((await heads())[0]).toMatchObject({ period: '2026-11' });
  expect((await lines())[0]).toMatchObject({ period: '2026-11' });
});

it('FR-024 projects and marks while the commissions feature is off', async () => {
  await owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${A.company},'commissions',false,'test disabled',${USER})`;
  expect(await deliver(event('ServiceSessionRecorded'))).toEqual({ delivered: true });
  expect(await heads()).toHaveLength(1);
  expect(await marks()).toHaveLength(1);
});

it('a malformed performer sum fails delivery without rows or a consumer mark', async () => {
  const malformed = event('ServiceSessionRecorded', {
    performers: [{ employee_id: A.employee, share_bps: 9000 }],
  });
  await expect(db.withTenant(A.company, (tx) => consumer.handle(tx, malformed)))
    .rejects.toBeInstanceOf(CommissionLineEventInvalidError);
  expect(await deliver(malformed)).toMatchObject({ delivered: false });
  expect(await heads()).toEqual([]);
  expect(await lines()).toEqual([]);
  expect(await marks()).toEqual([]);
});

it('an equal revision under a new event id is delivered and marked without touching a row', async () => {
  await deliver(event('ServiceSessionRecorded'));
  const headsBefore = await heads();
  const linesBefore = await lines();
  const added = event('ServiceSessionLinesAdded', {
    id: '01920000-0000-7000-8000-00000000e301',
    lineId: COMMISSION_LINE_IDS.lineA,
  });
  expect(await deliver(added)).toEqual({ delivered: true });
  expect(await heads()).toEqual(headsBefore);
  expect(await lines()).toEqual(linesBefore);
  expect(await marks()).toHaveLength(2);
});
