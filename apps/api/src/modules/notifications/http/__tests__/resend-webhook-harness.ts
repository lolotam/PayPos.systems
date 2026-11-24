import { EmailFeedbackQueueUnavailableError } from '../../ports/email-feedback.repository.ts';
import { createHash, createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformEmailDatabase, type PlatformEmailDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type Logger } from '@pospay/observability';
import { resendSigningKey } from '@pospay/notifications';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { API_LOG_EVENTS } from '../../../../shared/log-events.ts';
import { createTestDatabase } from '../../../../../../../packages/db/test/test-database.ts';
import { readPgTestEnv } from '../../../../../../../packages/db/test/pg-env.ts';
import { createApp } from '../../../../app.ts';
import { createEmailFeedbackInboxRepository } from '../../persistence/drizzle-email-feedback.repository.ts';
import { ReceiveEmailFeedback } from '../../use-cases/receive-email-feedback/receive-email-feedback.ts';

export const secret = ['whsec', Buffer.from('resend-webhook-secret').toString('base64')].join('_');
export const remote = '127.0.0.42';
export const eventId = 'msg_test_resend_event';
export const emailId = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
export const address = 'owner@example.invalid';
export const at = new Date('2026-11-23T10:00:00Z');
export const timestamp = String(Math.floor(at.getTime() / 1000));

/** The full provider body; the intake must keep the allowlisted fields only. */
export const event = (type = 'email.bounced') => ({
  type,
  created_at: '2026-11-23T10:00:00.000Z',
  data: {
    email_id: emailId,
    to: [address],
    from: 'no-reply@send.pospay.systems',
    subject: 'Your document expires soon',
    tags: [{ name: 'company_id', value: '01920000-0000-7000-8000-000000000001' }],
    bounce: {
      type: 'Permanent',
      subType: 'General',
      diagnosticCode: ['smtp; 550 5.5.0 Requested action not taken: mailbox unavailable'],
      message: 'mailbox unavailable',
    },
  },
});

export const sign = (payload: string, id = eventId, stamp = timestamp) =>
  `v1,${createHmac('sha256', resendSigningKey(secret))
    .update(`${id}.${stamp}.`)
    .update(payload)
    .digest('base64')}`;

export interface ResendHarness {
  readonly app: NestFastifyApplication;
  readonly database: PlatformEmailDatabase;
  readonly test: Awaited<ReturnType<typeof createTestDatabase>>;
  readonly owner: postgres.Sql;
  readonly redis: Redis;
  readonly chunks: string[];
  readonly jobs: { inbox_id: string }[];
  readonly failEnqueue: (value: boolean | 'hang') => void;
  readonly clearJobs: () => void;
  readonly post: (
    payload: string,
    headers?: Record<string, string | string[]>,
    signed?: boolean,
    id?: string,
  ) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
  readonly resetLimits: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/** The signed intake of the tests: one real database facade with a stubbed queue. */
export async function resendHarness(): Promise<ResendHarness> {
  const test = await createTestDatabase();
  const owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  const database: PlatformEmailDatabase = createPlatformEmailDatabase({
    url: test.notificationsUrl,
  });
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
  const logger: Logger = createLogger('info', {
    events: API_LOG_EVENTS,
    destination: { write: (chunk) => chunks.push(chunk) },
  });
  const intake = testIntake(database);
  const app: NestFastifyApplication = await createApp(
    { readiness: [], redis, resend: intake.intake, trustedProxy: ['127.0.0.1'] },
    { logger },
  );
  return {
    app,
    database,
    test,
    owner,
    redis,
    chunks,
    jobs: intake.jobs,
    failEnqueue: intake.failEnqueue,
    clearJobs: () => {
      intake.jobs.length = 0;
    },
    post: signedPost(app),
    resetLimits: async () => {
      await redis.del(`rate:resend:ip:POST:${createHash('sha256').update(remote).digest('hex')}`);
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

function testIntake(database: PlatformEmailDatabase) {
  const jobs: { inbox_id: string }[] = [];
  let enqueueFailure: boolean | 'hang' = false;
  const receive = new ReceiveEmailFeedback(
    createEmailFeedbackInboxRepository(database, systemUuidV7()),
    {
      enqueue: async (id, deadline) => {
        if (enqueueFailure === 'hang') await new Promise<void>(() => undefined);
        if (enqueueFailure) throw new EmailFeedbackQueueUnavailableError();
        if (deadline.getTime() <= at.getTime()) throw new EmailFeedbackQueueUnavailableError();
        jobs.push({ inbox_id: id });
      },
    },
    { now: () => at },
  );
  return {
    jobs,
    failEnqueue: (value: boolean | 'hang') => {
      enqueueFailure = value;
    },
    receive,
    intake: {
      config: { webhookSecret: secret, eventDigestKey: Buffer.alloc(32, 9) },
      receive,
      clock: { now: () => at },
    },
  };
}

function signedPost(app: NestFastifyApplication) {
  return async (
    payload: string,
    headers: Record<string, string | string[]> = {},
    signed = true,
    id = eventId,
  ) =>
    app.inject({
      method: 'POST',
      url: '/v1/webhooks/resend',
      remoteAddress: remote,
      payload,
      headers: {
        'content-type': 'application/json',
        ...(signed
          ? {
              'svix-id': id,
              'svix-timestamp': timestamp,
              'svix-signature': sign(payload, id),
            }
          : {}),
        ...headers,
      },
    });
}
