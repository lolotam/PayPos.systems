// قارئ زيارات اليوم بيجي من orders عن طريق نفس السهم اللي جذر العامل بيحقنه (ADR-0041)؛ السهم هنا للاختبار فقط.
import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../packages/db/test/orders-fixture.ts';
import { createDeliverer } from '../../outbox/deliver.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import { createRatingBootstrap, createRatingSchedulingConsumer } from '../../modules/customers/index.ts';
import type { RatingRequestsSwitchPort } from '../../modules/customers/ports/rating-requests-switch.port.ts';
import { schedulingData } from './rating-scheduling-data.ts';

export { everyDay } from './rating-scheduling-data.ts';
export type { BranchOptions, RatingEventType, SessionOptions } from './rating-scheduling-data.ts';

/** المفتاح اللي بيتقفل عليه الطلب: النشاط والعميل ويوم الطلب. */
export interface SwitchFake extends RatingRequestsSwitchPort {
  on: boolean;
}

export async function ratingSchedulingFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 6 });
  const clock = {
    at: new Date('2026-06-01T00:00:00.000Z'),
    now(): Date {
      return this.at;
    },
  };
  const enabled: SwitchFake = {
    on: true,
    enabled: async () => enabled.on,
  };
  const consumer = createRatingSchedulingConsumer({
    ids,
    clock,
    daySessions: daySessionsReader,
    ratingSwitch: enabled,
  });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return {
    testDb,
    owner,
    db,
    ids,
    clock,
    enabled,
    consumer,
    deliver,
    tenant: TENANT.A,
    bootstrap: (log: (line: string) => void) =>
      createRatingBootstrap({
        ids,
        clock,
        daySessions: daySessionsReader,
        ratingSwitch: enabled,
        db,
        log,
      }),
    ...schedulingData({ owner, db, ids }),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type RatingSchedulingFixture = Awaited<ReturnType<typeof ratingSchedulingFixture>>;
