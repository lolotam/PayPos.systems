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
import { discountApprovalData } from './discount-approval-notice-data.ts';
import { selfApprovalData } from './discount-self-approval-notice-data.ts';

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
  const context = { owner, db, ids, at };
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
    ...discountApprovalData(context),
    ...selfApprovalData(context),
    notices: (eventId: string) =>
      owner`SELECT * FROM discount_self_approval_notices WHERE source_event_id=${eventId} ORDER BY id`,
    bells: (eventId: string) =>
      owner`SELECT o.* FROM outbox o JOIN discount_self_approval_notices n
        ON n.company_id=o.company_id AND n.id=o.aggregate_id
        WHERE n.source_event_id=${eventId} AND o.event_type='DiscountSelfApprovalNoticeRequested' ORDER BY o.seq`,
    consumed: (eventId: string) =>
      owner`SELECT event_id FROM consumed_events WHERE consumer_id=${consumer.id} AND event_id=${eventId}`,
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
