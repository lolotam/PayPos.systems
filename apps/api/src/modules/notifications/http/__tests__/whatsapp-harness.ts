import {
  WhatsappQueueUnavailableError,
  WhatsappDigestUnavailableError,
} from '@pospay/notifications';
import { API_LOG_EVENTS } from '../../../../shared/log-events.ts';
import { createHash, createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformWhatsappDatabase, type PlatformWhatsappDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { readPgTestEnv } from '../../../../../../../packages/db/test/pg-env.ts';
import { createTestDatabase } from '../../../../../../../packages/db/test/test-database.ts';
import { createApp } from '../../../../app.ts';
import { createWhatsappInboxRepository } from '../../persistence/drizzle-whatsapp-inbox.repository.ts';
import { createWhatsappEnvelopeAdapter } from '../../persistence/whatsapp-envelope.adapter.ts';
import { ReceiveWhatsappStop } from '../../use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';

export const config = {
  appSecret: 'test-secret',
  verifyToken: 'test-secret',
  wabaId: '10041',
  phoneNumberId: '10042',
  phoneHashKey: 'test-secret'.repeat(4),
  messageHashKey: 'test-secret'.repeat(4),
  hashKeyId: 'test-v1',
  stopButtonId: 'test-stop',
};
export const phone = '+96500000001';
export const providerId = `test.${Buffer.from(phone).toString('base64')}`;
export const remote = '127.0.0.41';
export const envelope = (text = 'STOP', id = providerId) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: config.wabaId,
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: config.phoneNumberId, display_phone_number: phone },
            contacts: [{ wa_id: phone, profile: { name: phone } }],
            statuses: [{ id: providerId, recipient_id: phone }],
            messages: [
              {
                id,
                from: phone.slice(1),
                timestamp: '1790848800',
                type: 'text',
                text: { body: text },
                context: { id: providerId },
                unknown: phone,
              },
            ],
          },
        },
      ],
    },
  ],
});

export async function whatsappHarness() {
  const test = await createTestDatabase();
  const owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  const database = createPlatformWhatsappDatabase({ url: test.notificationsUrl });
  await database.ping();
  readPgTestEnv();
  const redis = new Redis(
    process.env['REDIS_URL'] ??
      `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:6379`,
    { maxRetriesPerRequest: 1 },
  );
  redis.on('error', () => undefined);
  await redis.ping();
  const chunks: string[] = [];
  const logger = createLogger('info', {
    events: API_LOG_EVENTS,
    destination: {
      write: (chunk) => {
        chunks.push(chunk);
      },
    },
  });
  const intake = testIntake(database, owner, logger);
  const app: NestFastifyApplication = await createApp(
    {
      readiness: [],
      redis,
      whatsapp: intake.whatsapp,
      trustedProxy: ['127.0.0.1'],
    },
    { logger },
  );
  return {
    app,
    database,
    test,
    owner,
    redis,
    chunks,
    ...intake,
    post: signedPost(app),
    resetLimits: async () => {
      const digest = createHash('sha256').update(remote).digest('hex');
      await redis.del(
        `rate:whatsapp:ip:POST:${digest}`,
        `rate:whatsapp:ip:GET:${digest}`,
        `rate:whatsapp:phone-number:${config.phoneNumberId}`,
      );
    },
    close: async () => {
      await app.close();
      await database.close();
      await owner.end();
      await redis.quit();
      await test.drop();
    },
  };
}

function testIntake(database: PlatformWhatsappDatabase, owner: postgres.Sql, logger: Logger) {
  const jobs: { inbox_id: string }[] = [];
  let enqueueAttempts = 0;
  let enqueueFailure = false;
  let scrubFailure = false;
  let commitFailure: 'rollback' | 'unknown' | 'lock' | 'deadline' | 'unexpected' | undefined;
  const durable = testDatabase(database, () => commitFailure);
  const receive = new ReceiveWhatsappStop(
    createWhatsappInboxRepository(durable, systemUuidV7()),
    {
      enqueue: async (id) => {
        const [row] =
          await owner`SELECT suppression_applied_at, command FROM platform_whatsapp_inbox WHERE id = ${id}`;
        if (
          row === undefined ||
          (row['command'] === 'STOP' && row['suppression_applied_at'] === null)
        )
          throw new Error('TEST_STOP_NOT_COMMITTED');
        enqueueAttempts++;
        if (enqueueFailure) throw new WhatsappQueueUnavailableError();
        jobs.push({ inbox_id: id });
      },
    },
    { now: () => new Date('2026-10-01T10:00:00Z') },
  );
  const scrub = createWhatsappEnvelopeAdapter(config, (count) =>
    logger.warn({ skipped: count }, 'whatsapp changes skipped'),
  );
  return {
    jobs,
    enqueueAttempts: () => enqueueAttempts,
    whatsapp: {
      config,
      receive,
      scrub: (input: Parameters<typeof scrub>[0]) => {
        if (scrubFailure) throw new WhatsappDigestUnavailableError();
        return scrub(input);
      },
    },
    failEnqueue: (value: boolean) => {
      enqueueFailure = value;
    },
    failScrub: (value: boolean) => {
      scrubFailure = value;
    },
    failCommit: (value: typeof commitFailure) => {
      commitFailure = value;
    },
  };
}

function signedPost(app: NestFastifyApplication) {
  return (body: unknown, headers: Record<string, string> = {}, signed = true) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', config.appSecret).update(Buffer.from(payload)).digest('hex')}`;
    return app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      remoteAddress: remote,
      payload,
      headers: {
        'content-type': 'application/json',
        ...(signed ? { 'x-hub-signature-256': signature } : {}),
        ...headers,
      },
    });
  };
}

function injectFailure(failure: string | undefined): void {
  if (failure === 'lock')
    throw Object.assign(new Error(providerId), { name: 'PostgresError', code: '55P03' });
  if (failure === 'deadline') throw Object.assign(new Error(providerId), { name: 'TimeoutError' });
  if (failure === 'unexpected') throw new TypeError(providerId);
}

function testDatabase(
  database: PlatformWhatsappDatabase,
  failure: () => string | undefined,
): PlatformWhatsappDatabase {
  return {
    ...database,
    withGlobal: async (work) => {
      injectFailure(failure());
      const result = await database.withGlobal(async (tx) => {
        const value = await work(tx);
        if (failure() === 'rollback') throw new Error('TEST_ROLLBACK');
        return value;
      });
      if (failure() === 'unknown')
        throw Object.assign(new Error(providerId), { name: 'CommitOutcomeUnknownError' });
      return result;
    },
  };
}
