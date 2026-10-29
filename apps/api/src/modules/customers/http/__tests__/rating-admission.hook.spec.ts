import { describe, expect, it } from 'vitest';

import {
  RateLimiterUnavailableError,
  type RateLimiter,
} from '../../../../shared/ports/rate-limiter.port.ts';
import { ratingAdmissionHook } from '../rating-admission.hook.ts';

interface FakeReply {
  readonly headers: Record<string, string>;
  readonly sent: { status?: number; body?: unknown };
  readonly reply: {
    header: (name: string, value: string) => unknown;
    code: (status: number) => unknown;
    send: (body: unknown) => unknown;
  };
}

function fakeReply(): FakeReply {
  const headers: Record<string, string> = {};
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    header: (name: string, value: string) => {
      headers[name] = value;
      return reply;
    },
    code: (status: number) => {
      sent.status = status;
      return reply;
    },
    send: (body: unknown) => {
      sent.body = body;
      return reply;
    },
  };
  return { headers, sent, reply };
}

const request = { ip: '203.0.113.9' } as unknown as Parameters<
  ReturnType<typeof ratingAdmissionHook>
>[0];

function limiter(overrides: Partial<RateLimiter> = {}): RateLimiter {
  return {
    hit: async () => true,
    remember: async () => undefined,
    remembered: async () => false,
    count: async () => 0,
    remaining: async () => 60,
    ...overrides,
  };
}

describe('the rating admission gate', () => {
  it('lets a request through and marks the answer as uncacheable', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({ limiter: limiter(), available: true })(request, fake.reply);
    expect(fake.sent.status).toBeUndefined();
    expect(fake.headers['cache-control']).toBe('no-store');
    expect(fake.headers['referrer-policy']).toBe('no-referrer');
  });

  it('refuses with NOT_READY when the capability is unavailable, without hitting the limiter', async () => {
    const fake = fakeReply();
    let hits = 0;
    await ratingAdmissionHook({
      limiter: limiter({
        hit: async () => {
          hits += 1;
          return true;
        },
      }),
      available: false,
    })(request, fake.reply);
    expect(hits).toBe(0);
    expect(fake.sent.status).toBe(503);
    expect(fake.sent.body).toMatchObject({ code: 'NOT_READY' });
    expect(fake.headers['cache-control']).toBe('no-store');
  });

  it('refuses with NOT_READY when there is no limiter', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({ limiter: null, available: true })(request, fake.reply);
    expect(fake.sent.status).toBe(503);
    expect(fake.sent.body).toMatchObject({ code: 'NOT_READY' });
  });

  it('refuses with NOT_READY when the limiter answers with an unusable reply', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({
      limiter: limiter({
        hit: async () => {
          throw new RateLimiterUnavailableError();
        },
      }),
      available: true,
    })(request, fake.reply);
    expect(fake.sent.status).toBe(503);
    expect(fake.sent.body).toMatchObject({ code: 'NOT_READY' });
  });

  it('refuses with NOT_READY when Redis rejects the hit', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({
      limiter: limiter({
        hit: async () => {
          throw new Error('connection refused');
        },
      }),
      available: true,
    })(request, fake.reply);
    expect(fake.sent.status).toBe(503);
    expect(fake.sent.body).toMatchObject({ code: 'NOT_READY' });
  });

  it('refuses with NOT_READY when the remaining seconds cannot be read', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({
      limiter: limiter({
        hit: async () => false,
        remaining: async () => {
          throw new RateLimiterUnavailableError();
        },
      }),
      available: true,
    })(request, fake.reply);
    expect(fake.sent.status).toBe(503);
    expect(fake.sent.body).toMatchObject({ code: 'NOT_READY' });
  });

  it('answers TOO_MANY_REQUESTS with the remaining seconds of the window', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({
      limiter: limiter({ hit: async () => false, remaining: async () => 17 }),
      available: true,
    })(request, fake.reply);
    expect(fake.sent.status).toBe(429);
    expect(fake.sent.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(fake.headers['retry-after']).toBe('17');
  });

  it('never promises less than one second', async () => {
    const fake = fakeReply();
    await ratingAdmissionHook({
      limiter: limiter({ hit: async () => false, remaining: async () => 0 }),
      available: true,
    })(request, fake.reply);
    expect(fake.sent.status).toBe(429);
    expect(fake.headers['retry-after']).toBe('1');
  });
});
