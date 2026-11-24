import { createHash } from 'node:crypto';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { createResendEventDigest, RESEND_INTAKE_BUDGET_MS } from '@pospay/notifications';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../../../app.ts';
import { readResendBody } from '../resend-body.ts';
import {
  address,
  emailId,
  event,
  eventId,
  remote,
  resendHarness,
  secret,
  sign,
  timestamp,
  type ResendHarness,
} from './resend-webhook-harness.ts';

let h: ResendHarness;
beforeAll(async () => {
  h = await resendHarness();
});
beforeEach(async () => {
  await h.resetLimits();
  h.failEnqueue(false);
  h.clearJobs();
});
afterAll(async () => {
  await h?.close();
});

const rows = () => h.owner`SELECT * FROM platform_email_feedback_inbox`;

async function postWithControlledEnqueue(id: string, beforeDeadline: boolean) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const queue = h.holdEnqueue();
  try {
    const response = h.post(JSON.stringify(event()), {}, true, id);
    await Promise.race([
      queue.entered,
      response.then(({ statusCode }) => {
        throw new Error(`Response ${statusCode} arrived before durable enqueue began`);
      }),
    ]);
    if (beforeDeadline) queue.settle(true);
    else await vi.advanceTimersByTimeAsync(RESEND_INTAKE_BUDGET_MS);
    return await response;
  } finally {
    queue.settle(false);
    vi.useRealTimers();
  }
}

it('destroys an unfinished body reader at its deadline instead of retaining the upload', async () => {
  const stream = new PassThrough();
  const body = readResendBody(stream, 10);
  stream.write(Buffer.from('{"type":"email.bounced",'));
  await expect(body).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(stream.destroyed).toBe(true);
  expect(stream.readableLength).toBe(0);
  expect(stream.listenerCount('data')).toBe(0);
});

it('answers NOT_READY without storing when Redis admission never completes', async () => {
  const before = await rows();
  const admission = vi.spyOn(h.redis, 'eval').mockReturnValueOnce(new Promise(() => undefined));
  try {
    const response = await h.post(JSON.stringify(event()), {}, true, 'msg_admission_timeout');
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'NOT_READY' });
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(0);
  } finally {
    admission.mockRestore();
  }
});

it('answers NOT_READY after a driver disconnect without SQLSTATE', async () => {
  const before = await rows();
  const withGlobal = h.database.withGlobal;
  const storage = vi.spyOn(h.database, 'withGlobal').mockImplementationOnce((_work, timeoutMs) =>
    withGlobal(async () => {
      throw new Error('driver failure', {
        cause: Object.assign(new Error('socket closed'), { code: 'CONNECTION_CLOSED' }),
      });
    }, timeoutMs),
  );
  try {
    const response = await h.post(JSON.stringify(event()), {}, true, 'msg_driver_disconnect');
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'NOT_READY' });
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(0);
  } finally {
    storage.mockRestore();
  }
});

/** One real-socket POST whose svix-signature header is sent twice; answers the response status. */
const twiceSignedStatus = (server: http.Server, payload: string): Promise<number> => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return new Promise<number>((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/webhooks/resend',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          'svix-id': eventId,
          'svix-timestamp': timestamp,
          'svix-signature': [sign(payload), sign(payload)],
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.end(payload);
    request.on('error', reject);
  });
};

describe('stores the scrubbed envelope and deduplicates', () => {
  it('stores one scrubbed row and enqueues one id-only job', async () => {
    const before = await rows();
    const response = await postWithControlledEnqueue(eventId, true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"received":true}');
    const stored = await rows();
    expect(stored).toHaveLength(before.length + 1);
    const row = stored[0];
    expect(row?.['event_type']).toBe('email.bounced');
    expect(row?.['bounce_class']).toBe('PERMANENT');
    expect(row?.['enqueue_confirmed_at']).not.toBeNull();
    expect(h.jobs).toEqual([{ inbox_id: row?.['id'] }]);
    const persisted = JSON.stringify(stored);
    for (const forbidden of [
      address,
      'Your document expires soon',
      'company_id',
      'mailbox unavailable',
    ])
      expect(persisted).not.toContain(forbidden);
    // الغلاف المخزّن منمّط: وقت ISO والتصنيف المحدود بس، مش كلمات المزود الخام. postgres.js بيرجّع jsonb
    // مفكوك بالفعل، فبقراه ككائن مباشرة.
    const envelope = row?.['raw_event'] as { created_at: string; bounce_type?: string };
    expect(envelope.created_at).toBe('2026-11-23T10:00:00.000Z');
    expect(envelope.bounce_type).toBe('PERMANENT');
    expect(h.chunks.join('')).not.toContain(address);
    expect(h.chunks.join('')).not.toContain(secret);
  });

  it('stores an unrecognised bounce word as unknown evidence, without the raw word', async () => {
    const before = await rows();
    const payload = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-11-23T09:00:00Z',
      data: {
        email_id: emailId,
        bounce: { type: 'Undetermined', message: 'anything the provider says' },
      },
    });
    expect((await h.post(payload, {}, true, 'msg_test_unknown_bounce')).statusCode).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(before.length + 1);
    const digest = createResendEventDigest(Buffer.alloc(32, 9))('msg_test_unknown_bounce');
    const [row] =
      await h.owner`SELECT * FROM platform_email_feedback_inbox WHERE provider_event_digest = ${digest}`;
    expect(row?.['bounce_class']).toBeNull();
    const envelope = row?.['raw_event'] as { bounce_type?: string };
    expect(envelope.bounce_type).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('anything the provider says');
  });

  it('acknowledges a replay of the same event and stores nothing new', async () => {
    const payload = JSON.stringify(event());
    expect((await h.post(payload)).statusCode).toBe(200);
    const before = await rows();
    const jobs = h.jobs.length;
    expect((await h.post(payload)).statusCode).toBe(200);
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(jobs);
  });
});

describe('acknowledges replays and leaves late work to the recovery path', () => {
  it('acknowledges a replay while inbox writes are blocked', async () => {
    const payload = JSON.stringify(event());
    expect((await h.post(payload, {}, true, 'msg_test_replay_alone')).statusCode).toBe(200);
    const jobs = h.jobs.length;
    await h.owner.begin(async (tx) => {
      await tx`LOCK TABLE platform_email_feedback_inbox IN SHARE MODE`;
      const before = await tx`SELECT * FROM platform_email_feedback_inbox ORDER BY id`;
      expect((await h.post(payload, {}, true, 'msg_test_replay_alone')).statusCode).toBe(200);
      expect(await tx`SELECT * FROM platform_email_feedback_inbox ORDER BY id`).toEqual(before);
    });
    expect(h.jobs).toHaveLength(jobs);
  });

  it('acknowledges an unknown event type without storing it', async () => {
    const before = await rows();
    const jobs = h.jobs.length;
    const payload = JSON.stringify({ type: 'email.clicked' });
    expect((await h.post(payload)).statusCode).toBe(200);
    expect(await rows()).toEqual(before);
    expect(h.jobs).toHaveLength(jobs);
  });

  it('keeps the row unconfirmed when the enqueue fails, and still answers 200', async () => {
    h.failEnqueue(true);
    // حدث جديد بكامل معرّفه: لو تكرر svix-id لكان إعادة تسليم مؤكدة بـ 200 بلا صف جديد.
    const id = 'msg_test_resend_event_2';
    expect((await h.post(JSON.stringify(event()), {}, true, id)).statusCode).toBe(200);
    const digest = createResendEventDigest(Buffer.alloc(32, 9))(id);
    const unconfirmed = await h.owner`SELECT enqueue_confirmed_at FROM platform_email_feedback_inbox
      WHERE provider_event_digest = ${digest}`;
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]?.['enqueue_confirmed_at']).toBeNull();
    expect(h.jobs).toHaveLength(0);
  });

  it('acknowledges a committed row with 200 when enqueue never settles', async () => {
    const id = 'msg_test_durable_enqueue_timeout';
    const response = await postWithControlledEnqueue(id, false);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });
    const digest = createResendEventDigest(Buffer.alloc(32, 9))(id);
    const stored = await h.owner`SELECT enqueue_confirmed_at FROM platform_email_feedback_inbox
      WHERE provider_event_digest = ${digest}`;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.['enqueue_confirmed_at']).toBeNull();
    expect(h.jobs).toHaveLength(0);
  });
});

describe('refuses an unauthentic request', () => {
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
    expect((await h.post(payload, { 'svix-id': [eventId, eventId] })).statusCode).toBe(401);
    expect(await rows()).toEqual(before);
  });

  // التكرار الحقيقي للهيدر ما بيوصلهش عبر inject (بيسلسل المصفوفة)، فبيتأكد عبر سوكت حقيقي.
  it('refuses a signature header sent twice over the wire', async () => {
    const payload = JSON.stringify(event());
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const server = h.app.getHttpServer();
    try {
      expect(await twiceSignedStatus(server, payload)).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('refuses a malformed request and a degraded capability', () => {
  it('refuses a provider id outside the documented UUID shape and a body outside the allowlist', async () => {
    const payload = JSON.stringify({ type: 'email.bounced', created_at: 'x' });
    expect((await h.post(payload)).statusCode).toBe(400);
    expect(
      (
        await h.post(
          JSON.stringify({
            type: 'email.bounced',
            created_at: '2026-11-23T10:00:00.000Z',
            data: { email_id: 'owner@example.invalid' },
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await h.post(JSON.stringify(event()), { 'content-type': 'text/plain' })).statusCode,
    ).toBe(415);
    expect((await h.post(JSON.stringify(event()), { 'content-encoding': 'gzip' })).statusCode).toBe(
      415,
    );
    expect((await h.post('x'.repeat(65_537))).statusCode).toBe(413);
  });

  it('limits the requests per IP with the contracted RATE_LIMITED code', async () => {
    const digest = createHash('sha256').update(remote).digest('hex');
    await h.redis.set(`rate:resend:ip:POST:${digest}`, 120, 'EX', 60);
    const response = await h.post(JSON.stringify(event()));
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect((JSON.parse(response.body) as { code: string }).code).toBe('RATE_LIMITED');
  });

  it('answers NOT_READY when the capability is not configured', async () => {
    const app: NestFastifyApplication = await createApp({
      readiness: [],
      redis: h.redis,
      trustedProxy: ['127.0.0.1'],
    });
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
