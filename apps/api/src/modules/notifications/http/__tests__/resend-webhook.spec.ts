import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformEmailDatabase, type PlatformEmailDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { EmailFeedbackQueueUnavailableError, resendSigningKey } from '@pospay/notifications';
import { API_LOG_EVENTS } from '../../../../shared/log-events.ts';
import { createTestDatabase } from '../../../../../../../packages/db/test/test-database.ts';
import { readPgTestEnv } from '../../../../../../../packages/db/test/pg-env.ts';
import { createApp } from '../../../../app.ts';
import { createEmailFeedbackInboxRepository } from '../../persistence/drizzle-email-feedback.repository.ts';
import { ReceiveEmailFeedback } from '../../use-cases/receive-email-feedback/receive-email-feedback.ts';

const secret = `whsec_${Buffer.from('resend-webhook-secret').toString('base64')}`;
const remote = '127.0.0.42';
const eventId = 'msg_test_resend_event';
const emailId = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const address = 'owner@example.invalid';
const at = new Date('2026-11-23T10:00:00Z');
const timestamp = String(Math.floor(at.getTime() / 1000));

const event = (type = 'email.bounced') => ({
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
const sign = (payload: string, id = eventId, stamp = timestamp) =>
  `v1,${createHmac('sha256', resendSigningKey(secret))
    .update(`${id}.${stamp}.`)
    .update(payload)
    .digest('base64')}`;

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});
beforeEach(async () => {
  await h.resetLimits();
  h.failEnqueue(false);
});
afterAll(async () => {
  await h?.close();
});

async function harness() {
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
  const logger = createLogger('info', {
    events: API_LOG_EVENTS,
    destination: {
      write: (chunk) => {
        chunks.push(chunk);
      },
    },
  });
  const jobs: { inbox_id: string }[] = [];
  let enqueueFailure = false;
  const receive = new ReceiveEmailFeedback(
    createEmailFeedbackInboxRepository(database, systemUuidV7()),
    {
      enqueue: async (id) => {
        if (enqueueFailure) throw new EmailFeedbackQueueUnavailableError();
        jobs.push({ inbox_id: id });
      },
    },
    { now: () => at },
  );
  const intake = {
    config: { webhookSecret: secret },
    receive,
    clock: { now: () => at },
  };
  const app: NestFastifyApplication = await createApp(
    { readiness: [], redis, resend: intake, trustedProxy: ['127.0.0.1'] },
    { logger },
  );
  return {
    app,
    database,
    test,
    owner,
    redis,
    chunks,
    jobs,
    failEnqueue: (value: boolean) => {
      enqueueFailure = value;
    },
    post: (payload: string, headers: Record<string, string | string[]> = {}, signed = true) =>
      app.inject({
        method: 'POST',
        url: '/v1/webhooks/resend',
        remoteAddress: remote,
        payload,
        headers: {
          'content-type': 'application/json',
          ...(signed
            ? {
                'svix-id': eventId,
                'svix-timestamp': timestamp,
                'svix-signature': sign(payload),
              }
            : {}),
          ...headers,
        },
      }),
    resetLimits: async () => {
      const digest = createHash('sha256').update(remote).digest('hex');
      await redis.del(`rate:resend:ip:POST:${digest}`);
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

describe('signed Resend webhook', () => {
  const rows = () => h.owner`SELECT * FROM platform_email_feedback_inbox`;

  it('stores one scrubbed row and enqueues one id-only job', async () => {
    const before = await rows();
    const response = await h.post(JSON.stringify(event()));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"received":true}');
    const stored = await rows();
    expect(stored).toHaveLength(before.length + 1);
    const row = stored[0];
    expect(row?.['event_type']).toBe('email.bounced');
    expect(row?.['bounce_class']).toBe('PERMANENT');
    expect(row?.['enqueue_confirmed_at']).not.toBeNull();
    expect(h.jobs).toHaveLength(1);
    expect(Object.keys(h.jobs[0] ?? {}).join()).toBe('inbox_id');
    const persisted = JSON.stringify(stored);
    for (const forbidden of [address, 'Your document expires soon', 'company_id', 'mailbox unavailable'])
      expect(persisted).not.toContain(forbidden);
    expect(h.chunks.join('')).not.toContain(address);
    expect(h.chunks.join('')).not.toContain(secret);
  });

  it('refuses a replay of the same event and stores nothing new', async () => {
    const payload = JSON.stringify(event());
    expect((await h.post(payload)).statusCode).toBe(200);
    const before = await rows();
    const jobs = h.jobs.length;
    expect((await h.post(payload)).statusCode).toBe(200);
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(jobs);
  });

  it('acknowledges an unknown event type without storing it', async () => {
    const before = await rows();
    const jobs = h.jobs.length;
    const payload = JSON.stringify(event('email.clicked'));
    expect((await h.post(payload)).statusCode).toBe(200);
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(jobs);
  });

  it('refuses a bad signature, a stale timestamp and a repeated header', async () => {
    const before = await rows();
    const payload = JSON.stringify(event());
    expect((await h.post(payload, { 'svix-signature': 'v1,AAAA' })).statusCode).toBe(401);
    expect(
      (
        await h.post(payload, {
          'svix-timestamp': String(Number(timestamp) - 600),
          'svix-signature': sign(payload, eventId, String(Number(timestamp) - 600)),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await h.post(payload, { 'svix-signature': [sign(payload), sign(payload)] })).statusCode,
    ).toBe(401);
    expect((await h.post(payload, { 'svix-id': [eventId, eventId] })).statusCode).toBe(401);
    expect(await rows()).toEqual(before);
  });

  it('refuses a body outside the allowlist and a wrong media type', async () => {
    const payload = JSON.stringify({ type: 'email.bounced', created_at: 'x' });
    expect((await h.post(payload)).statusCode).toBe(400);
    expect((await h.post(JSON.stringify(event()), { 'content-type': 'text/plain' })).statusCode).toBe(
      415,
    );
    expect((await h.post(JSON.stringify(event()), { 'content-encoding': 'gzip' })).statusCode).toBe(
      415,
    );
    expect((await h.post('x'.repeat(65_537))).statusCode).toBe(413);
  });

  it('keeps the row unconfirmed when the enqueue fails, and still answers 200', async () => {
    const before = await h.owner`SELECT enqueue_confirmed_at FROM platform_email_feedback_inbox`;
    h.failEnqueue(true);
    expect((await h.post(JSON.stringify(event()))).statusCode).toBe(200);
    const after = await h.owner`SELECT enqueue_confirmed_at FROM platform_email_feedback_inbox`;
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]?.['enqueue_confirmed_at']).toBeNull();
    expect(h.jobs).toHaveLength(0);
  });

  it('limits the requests per IP', async () => {
    const digest = createHash('sha256').update(remote).digest('hex');
    await h.redis.set(`rate:resend:ip:POST:${digest}`, 120, 'EX', 60);
    const response = await h.post(JSON.stringify(event()));
    expect([response.statusCode, response.headers['retry-after']]).toEqual([429, '60']);
  });

  it('answers NOT_READY when the capability is not configured', async () => {
    const app = await createApp({ readiness: [], redis: h.redis, trustedProxy: ['127.0.0.1'] });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/resend',
        remoteAddress: remote,
        payload: JSON.stringify(event()),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});
