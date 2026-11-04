import postgres from 'postgres';
import { createDatabase, createOutboxDispatcherDatabase, type ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import { createDiscountSelfApprovalNoticeConsumer } from '../index.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { discountSelfApprovalData } from './discount-self-approval-notice-data.ts';

export async function discountSelfApprovalFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  const at = new Date('2026-10-16T09:00:00.000Z');
  // عضوية البذرة تبدأ بـ now()، وساعة الجرس ثابتة قبلها، فتتقدم البداية حتى يبقى المالك مستلماً
  await owner`UPDATE memberships SET starts_at=${new Date('2026-01-01T00:00:00.000Z')} WHERE user_id=${USER}`;
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 4 });
  const dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  const consumer = createDiscountSelfApprovalNoticeConsumer(ids, { now: () => at });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return {
    testDb,
    owner,
    db,
    dispatcher,
    ids,
    at,
    consumer,
    deliver,
    tenant: TENANT.A,
    ...discountSelfApprovalData({ owner, db, ids, at }),
    // كل قارئ يأخذ شركة صريحة من نطاق القرار الموثوق، فلا يفترض أحدٌ شركة البذرة.
    notices: (companyId: string, sourceEventId: string) =>
      owner`SELECT * FROM discount_self_approval_notices WHERE company_id=${companyId} AND source_event_id=${sourceEventId} ORDER BY id`,
    decisions: (companyId: string, aggregateId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${companyId} AND event_type='DiscountSelfApprovalNoticeRequested' AND aggregate_id=${aggregateId} ORDER BY seq`,
    consumed: (companyId: string, eventId: string) =>
      owner`SELECT event_id FROM consumed_events WHERE company_id=${companyId} AND consumer_id=${consumer.id} AND event_id=${eventId}`,
    consume: (event: ClaimedEvent) =>
      db.withTenant(event.companyId, (tx) => consumer.handle(tx, event)),
    close: async () => {
      await dispatcher.close();
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type DiscountSelfApprovalFixture = Awaited<ReturnType<typeof discountSelfApprovalFixture>>;
