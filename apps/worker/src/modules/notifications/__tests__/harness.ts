import { appendOutboxEvent, createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTemplateRegistry, FakeChannel } from '@pospay/notifications';
import { createLogger, type Logger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createNotificationModule } from '../notifications.module.ts';

export const PHONE = '+96500000001';
export const NOW = new Date('2026-10-01T10:00:00Z');
export const logger: Logger = createLogger('silent');

export async function notificationHarness() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  let current = NOW;
  let suppressed = false;
  const clock = { now: () => new Date(current) };
  const channel = new FakeChannel(clock.now);
  const registry = testRegistry();
  const module = createNotificationModule({
    database: db,
    ids,
    clock,
    channel,
    registry,
    production: false,
    suppression: () => ({ isSuppressed: async () => suppressed }),
    configuration: {
      mode: 'fake',
      hashKey: 'test-key-not-a-secret'.repeat(3),
      hashKeyId: 'test-v1',
    },
  });
  const deliver = createDeliverer(db, [module.consumer], logger, {
    knownEventTypes: module.eventTypes,
  });
  const queries = testQueries(db, owner);
  return {
    db,
    testDb,
    module,
    channel,
    clock,
    deliver,
    ...queries,
    suppress: () => {
      suppressed = true;
    },
    advance: (at: Date) => {
      current = at;
    },
    request: testRequester(db, ids),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

function testRegistry() {
  return createTemplateRegistry(
    [
      {
        key: 'test_notice',
        revision: 1,
        locales: ['ar', 'en'],
        category: 'UTILITY',
        parameters: [],
        copy: { ar: '', en: '' },
      },
    ],
    { test_notice: { ar: 'test_notice_ar', en: 'test_notice_en' } },
  );
}

function testQueries(db: Database, owner: postgres.Sql) {
  const read = async (id: string, company = TENANT.A.company) =>
    db.withTenant(company, async (tx) => {
      const [row] = await tx.execute<Record<string, unknown>>(
        sql`SELECT * FROM notification_attempts WHERE id = ${id}`,
      );
      return row;
    });
  // Inspect committed outbox using the test owner; app gets INSERT only, never a new SELECT grant.
  const events = async () =>
    Array.from(
      await owner<{ event_type: string; payload: Record<string, unknown> }[]>`
    SELECT event_type, payload FROM outbox WHERE company_id = ${TENANT.A.company}`,
    );
  return {
    read,
    events,
    attempt: async (event: ClaimedEvent) =>
      db.withTenant(event.companyId, async (tx) => {
        const [row] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM notification_attempts WHERE source_event_id = ${event.id}`,
        );
        if (row === undefined) throw new Error('TEST_ATTEMPT_MISSING');
        return row.id;
      }),
  };
}

function testRequester(db: Database, ids: ReturnType<typeof systemUuidV7>) {
  return async (recipient: Record<string, unknown> = {}, company = TENANT.A.company) => {
    const id = ids.newId();
    const payload = {
      notification_recipients: [
        {
          phone: PHONE,
          locale: 'ar',
          channel: 'whatsapp',
          template_key: 'test_notice',
          template_revision: 1,
          safe_parameters: [],
          ...recipient,
        },
      ],
    };
    await db.withTenant(company, (tx) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'test',
        aggregateId: id,
        eventType: 'AppointmentBooked',
        payload,
      }),
    );
    const event: ClaimedEvent = {
      id,
      companyId: company,
      aggregateType: 'test',
      aggregateId: id,
      eventType: 'AppointmentBooked',
      payload,
      attempt: 1,
    };
    return event;
  };
}
