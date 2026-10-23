import { createHash } from 'node:crypto';

import { appendOutboxEvent, createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTemplateRegistry } from '@pospay/notifications';
import { createLogger, type Logger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import {
  NOTIFICATION_SOURCE_EVENTS,
  notificationRequestConsumer,
} from '../events/handlers/on-notification-request.handler.ts';
import { createInAppRepository } from '../persistence/drizzle-in-app.repository.ts';
import { createPushAttemptsRepository } from '../persistence/drizzle-push-attempts.repository.ts';
import { StoreInAppNotification } from '../use-cases/store-in-app-notification/store-in-app-notification.ts';
import { StorePushAttempts } from '../use-cases/store-push-attempts/store-push-attempts.ts';
import { pushQueries } from './push-harness-rows.ts';

export const PUSH_USER = USER;
export const OTHER_USER = '01920000-0000-7000-8000-0000000000f2';
export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic';
export const P256DH = 'p'.repeat(87);
export const AUTH = 'a'.repeat(22);
export const KEY_ID = '0123456789abcdef';
export const NOW = new Date('2026-10-01T10:00:00Z');
export const logger: Logger = createLogger('silent');

export const PUSH_PARAMETERS: { name: string; type: 'text'; value: string }[] = [
  { name: 'shift_start', type: 'text', value: '10:00' },
  { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
];

export const pushRecipient = (userId = PUSH_USER, deadline?: string) => ({
  channel: 'PUSH',
  user_id: userId,
  template_key: 'shift_not_clocked_in_self',
  template_revision: 1,
  safe_parameters: PUSH_PARAMETERS,
  ...(deadline === undefined ? {} : { send_deadline: deadline }),
});

export async function pushHarness(options: { pushEnabled?: boolean } = {}) {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${PUSH_USER},'Synthetic user','push-a@example.test'),
    (${OTHER_USER},'Synthetic other','push-b@example.test') ON CONFLICT DO NOTHING`;
  const clock = { now: () => new Date(NOW) };
  const consumer = pushConsumer(clock, ids, options.pushEnabled !== false);
  const deliver = createDeliverer(db, [consumer], logger, {
    knownEventTypes: NOTIFICATION_SOURCE_EVENTS,
  });
  const subscribe = async (
    company: string,
    id: string,
    userId: string,
    locale: 'ar' | 'en',
  ): Promise<string> => {
    const deliveryToken = ids.newId();
    await db.withTenant(company, (tx) =>
      tx.execute(liveSubscription(company, id, userId, locale, deliveryToken)),
    );
    return deliveryToken;
  };
  return {
    db,
    owner,
    ids,
    clock,
    consumer,
    disabled: pushConsumer(clock, ids, false),
    deliver,
    subscribe,
    subscribeRevoked: (company: string, id: string, userId: string) =>
      db.withTenant(company, (tx) => tx.execute(revokedSubscription(company, id, userId))),
    request: (recipients: object[]) => request(db, ids, recipients),
    ...pushQueries(owner),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

// المستهلك في الاختبار: قناة التليفون مقفولة، والدفع مفتوح أو مقفول على حسب الإعداد.
const pushConsumer = (
  clock: { now: () => Date },
  ids: ReturnType<typeof systemUuidV7>,
  enabled: boolean,
) =>
  notificationRequestConsumer(
    () => {
      throw new Error('PHONE_CHANNEL_NOT_USED');
    },
    {
      identify: () => {
        throw new Error('PHONE_CHANNEL_NOT_USED');
      },
    },
    createTemplateRegistry(),
    (tx) => new StoreInAppNotification(createInAppRepository(tx), clock, ids),
    undefined,
    {
      enabled,
      store: (tx) => new StorePushAttempts(createPushAttemptsRepository(tx), clock, ids),
    },
  );

const digest = (label: string) => createHash('sha256').update(label).digest();

const liveSubscription = (
  company: string,
  id: string,
  userId: string,
  locale: 'ar' | 'en',
  deliveryToken: string,
) => sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
  VALUES(${company},${id},${userId},${digest(`install:${id}`)},${ENDPOINT},${P256DH},${AUTH},
    ${digest(`endpoint:${id}`)},${deliveryToken},1,${locale},${KEY_ID},now(),now(),now())`;

const revokedSubscription = (company: string, id: string, userId: string) =>
  sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at,revoked_at,revoked_reason)
  VALUES(${company},${id},${userId},${digest(`install:${id}`)},null,null,null,
    ${digest(`endpoint:${id}`)},null,2,'ar',${KEY_ID},now(),now(),now(),now(),'UNSUBSCRIBED')`;

async function request(
  db: Database,
  ids: ReturnType<typeof systemUuidV7>,
  recipients: object[],
): Promise<ClaimedEvent> {
  const id = ids.newId();
  const payload = {
    business_id: TENANT.A.business,
    branch_id: TENANT.A.branch,
    notification_recipients: recipients,
  };
  await db.withTenant(TENANT.A.company, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'test',
      aggregateId: id,
      eventType: 'ShiftNotClockedIn',
      payload,
    }),
  );
  return {
    id,
    companyId: TENANT.A.company,
    aggregateType: 'test',
    aggregateId: id,
    eventType: 'ShiftNotClockedIn',
    payload,
    attempt: 1,
  };
}
