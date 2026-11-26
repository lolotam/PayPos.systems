import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import { businessTimeZone } from '../modules/tenancy/index.ts';
import { createDeliverer } from '../outbox/deliver.ts';
import { createTestCommissionInputsConsumer } from './commission-inputs-consumer.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;

// 00:05 من 2026-11-01 بالموقيت المحلي الكويتي: الشهر بالـ UTC لسه 2026-10.
const KUWAIT_AFTER_MIDNIGHT = '2026-10-31T21:05:00.000Z';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  // المنطقة تُقرأ من صف tenancy نفسه، فالسطر ده هو مصدر الحقيقة بتاع الشهر المحلي.
  await owner`UPDATE businesses SET timezone='Asia/Kuwait'
    WHERE company_id=${A.company} AND id=${A.business}`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

/** يسلّم الحدث في لحظة معروفة، بالقارئ الحقيقي للمنطقة الزمنية. */
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

it('reads the business timezone from the tenancy row and lands the line in the local month', async () => {
  const zone = await db.withTenant(A.company, (tx) => businessTimeZone(tx, A.company, A.business));
  expect(zone).toBe('Asia/Kuwait');

  const event = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    businessDate: '2026-11-01',
  });
  expect(await deliverAt(KUWAIT_AFTER_MIDNIGHT, event)).toEqual({ delivered: true });
  expect(
    await owner`SELECT period FROM commission_line_heads WHERE company_id=${A.company}`,
  ).toEqual([{ period: '2026-11' }]);
  expect(await owner`SELECT period FROM commission_lines WHERE company_id=${A.company}`).toEqual([
    { period: '2026-11' },
  ]);
});

it('corrects a closed previous month into the local next month and not the UTC one', async () => {
  const recorded = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    businessDate: '2026-10-15',
    ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  });
  expect(await deliverAt(KUWAIT_AFTER_MIDNIGHT, recorded)).toEqual({ delivered: true });
  await walkCommissionStatement(db, { tenant: A, period: '2026-10', ids, to: 'APPROVED' });

  const changed = commissionLineEvent(A, ids, 'ServiceLineChanged', {
    businessDate: '2026-10-15',
    revision: 2,
    ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  });
  // لو المستهلك قرأ الشهر بالـ UTC لكان 2026-10، ومكانش لقى شهر DRAFT هدف، والتسليم كان بيرفض.
  expect(await deliverAt(KUWAIT_AFTER_MIDNIGHT, changed)).toEqual({ delivered: true });
  expect(
    await owner`SELECT period,status FROM commission_statements
      WHERE company_id=${A.company} AND business_id=${A.business} ORDER BY period`,
  ).toEqual([
    { period: '2026-10', status: 'APPROVED' },
    { period: '2026-11', status: 'DRAFT' },
  ]);
  expect(
    await owner`SELECT code,source_period,target_period FROM commission_blocked_corrections
      WHERE company_id=${A.company}`,
  ).toEqual([{ code: 'NO_PLAN', source_period: '2026-10', target_period: '2026-11' }]);
});
