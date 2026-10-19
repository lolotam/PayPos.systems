import postgres from 'postgres';
import { createDatabase, createOutboxDispatcherDatabase, type ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import { createPerformersChangeNoticeConsumer } from '../index.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { performersChangeData } from './performers-change-data.ts';

export async function performersChangeFixture() {
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
  const consumer = createPerformersChangeNoticeConsumer(ids, { now: () => at });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const company = TENANT.A.company;
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
    ...performersChangeData({ owner, db, ids, at }),
    notices: (lineId: string) =>
      owner`SELECT * FROM service_line_performer_notices WHERE company_id=${company} AND line_id=${lineId} ORDER BY revision`,
    requests: (lineId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${company} AND event_type='ServiceLinePerformersNoticeRequested' AND payload->>'line_id'=${lineId} ORDER BY seq`,
    consumed: (eventId: string) =>
      owner`SELECT event_id FROM consumed_events WHERE company_id=${company} AND consumer_id=${consumer.id} AND event_id=${eventId}`,
    consume: (event: ClaimedEvent) => db.withTenant(event.companyId, (tx) => consumer.handle(tx, event)),
    close: async () => {
      await dispatcher.close();
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type PerformersChangeFixture = Awaited<ReturnType<typeof performersChangeFixture>>;
