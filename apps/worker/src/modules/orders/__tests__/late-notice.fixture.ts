import postgres from 'postgres';
import { createDatabase, createOutboxDispatcherDatabase, type ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import { createLateServiceSessionNoticeConsumer } from '../index.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { noticeData } from './late-notice-data.ts';

export async function lateNoticeFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  const at = new Date();
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 6 });
  const dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  const consumer = createLateServiceSessionNoticeConsumer(ids, { now: () => at });
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
    ...noticeData({ owner, db, ids, at }),
    notices: (sessionId: string) =>
      owner`SELECT * FROM late_service_session_notices WHERE company_id=${TENANT.A.company} AND session_id=${sessionId}`,
    requests: (sessionId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${TENANT.A.company} AND aggregate_id=${sessionId} AND event_type='LateServiceSessionNoticeRequested' ORDER BY seq`,
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
export type LateNoticeFixture = Awaited<ReturnType<typeof lateNoticeFixture>>;
