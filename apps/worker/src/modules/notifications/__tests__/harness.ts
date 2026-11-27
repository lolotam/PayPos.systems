import { appendOutboxEvent, createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTemplateRegistry,
  FakeChannel,
  readEmailConfiguration,
  type EmailRequest,
} from '@pospay/notifications';
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

/** بيئة بريد كاملة: القناة بتتفعّل بس لو ردّ المزود جاهز. */
export const EMAIL_ENV = {
  NOTIFICATION_EMAIL_HASH_KEY: 'synthetic-email-identity'.repeat(3),
  NOTIFICATION_EMAIL_HASH_KEY_ID: 'email-test-v1',
  ONBOARDING_EMAIL_ENVELOPE_KEY: 'test-only-envelope-material'.padEnd(36, '0'),
  RESEND_API_KEY: 'synthetic-test-only',
  EMAIL_FROM_ADDRESS: 'synthetic@send.pospay.systems',
  EMAIL_FROM_NAME: 'Synthetic sender',
  EMAIL_REPLY_TO: 'synthetic.replies@example.invalid',
  EMAIL_ADMIN_ORIGIN: 'https://app.pospay.systems',
  PLATFORM_NOTIFICATIONS_DATABASE_URL:
    'postgres://pospay_notifications:synthetic@127.0.0.1:5432/pospay',
};

function suppressionTracker() {
  let suppressed = false;
  const suppressedHashes: Uint8Array[] = [];
  return {
    isSuppressed: (hash?: Uint8Array) =>
      suppressed ||
      (hash !== undefined &&
        suppressedHashes.some((entry) => Buffer.from(entry).equals(Buffer.from(hash)))),
    isGlobalSuppressed: () => suppressed,
    suppress: () => {
      suppressed = true;
    },
    suppressHash: (hash: Uint8Array) => {
      suppressedHashes.push(hash);
    },
    clearSuppressions: () => {
      suppressed = false;
      suppressedHashes.length = 0;
    },
  };
}

export async function notificationHarness(
  options: { readonly emailChannel?: (now: () => Date) => FakeChannel<EmailRequest> } = {},
) {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  let current = NOW;
  const tracker = suppressionTracker();
  const clock = { now: () => new Date(current) };
  const channel = new FakeChannel(clock.now);
  const emailChannel =
    options.emailChannel?.(clock.now) ?? new FakeChannel<EmailRequest>(clock.now);
  const module = createNotificationModule({
    database: db,
    ids,
    clock,
    channel,
    registry: testRegistry(),
    production: false,
    ...testEmailOptions(emailChannel, tracker.isSuppressed),
    suppression: () => ({ isSuppressed: async () => tracker.isGlobalSuppressed() }),
    configuration: {
      mode: 'fake',
      hashKey: 'test-key-not-a-secret'.repeat(3),
      hashKeyId: 'test-v1',
    },
  });
  const deliver = createDeliverer(db, [module.consumer], logger, {
    knownEventTypes: module.eventTypes,
  });
  return {
    db,
    owner,
    testDb,
    module,
    channel,
    emailChannel,
    clock,
    deliver,
    ...testQueries(db, owner),
    suppress: tracker.suppress,
    suppressHash: tracker.suppressHash,
    clearSuppressions: tracker.clearSuppressions,
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

export function testEmailOptions(
  channel: FakeChannel<EmailRequest>,
  suppressed: (hash?: Uint8Array) => boolean = () => false,
) {
  return {
    emailConfiguration: readEmailConfiguration(EMAIL_ENV),
    emailEnvelopeKey: EMAIL_ENV.ONBOARDING_EMAIL_ENVELOPE_KEY,
    emailTesting: {
      channel,
      suppression: () => ({ isSuppressed: async (hash: Uint8Array) => suppressed(hash) }),
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
  const read = async (id: string, company: string = TENANT.A.company) =>
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
  return async (
    recipient: Record<string, unknown> = {},
    company: string = TENANT.A.company,
    eventType = 'AppointmentBooked',
  ) => {
    const id = ids.newId();
    const payload = {
      notification_recipients: [
        {
          ...(recipient['channel'] === 'email'
            ? { email: 'synthetic.owner@example.invalid' }
            : { phone: PHONE }),
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
        eventType,
        payload,
      }),
    );
    const event: ClaimedEvent = {
      id,
      companyId: company,
      aggregateType: 'test',
      aggregateId: id,
      eventType,
      payload,
      attempt: 1,
    };
    return event;
  };
}
