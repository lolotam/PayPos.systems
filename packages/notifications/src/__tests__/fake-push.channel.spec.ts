import { describe, expect, it } from 'vitest';

import { FakePushChannel, type FakePushOutcome } from '../adapters/fake-push.channel.ts';
import type { PushRequest, PushResult } from '../push/channel.ts';

const NOW = new Date('2026-10-23T10:00:00Z');
const PAYLOAD = '{"v":1,"title":"x","body":"y","tag":"z","url":"/personal","lang":"en","t":"t"}';

const request = (overrides: Partial<PushRequest> = {}): PushRequest => ({
  target: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-endpoint',
    p256dh: 'synthetic-p256dh',
    auth: 'synthetic-auth',
  },
  payload: PAYLOAD,
  ttlSeconds: 3600,
  urgency: 'high',
  topic: 'topic-of-the-event',
  deadline: null,
  ...overrides,
});

describe('the fake push channel', () => {
  const ROWS: [FakePushOutcome, PushResult][] = [
    ['accepted', { kind: 'accepted', httpStatus: 201 }],
    ['gone404', { kind: 'gone', httpStatus: 404 }],
    ['gone410', { kind: 'gone', httpStatus: 410 }],
    ['400', { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 400, vapidRejected: false }],
    ['401', { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 401, vapidRejected: true }],
    ['403', { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 403, vapidRejected: true }],
    ['413', { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 413, vapidRejected: false }],
    ['429', { kind: 'rejected', code: 'PROVIDER_429', httpStatus: 429, vapidRejected: false }],
    ['5xx', { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: 503 }],
    [
      'timeout',
      { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: null },
    ],
  ];

  it.each(ROWS)('answers %s with a bounded result', async (outcome, expected) => {
    const fake = new FakePushChannel(() => NOW);
    fake.outcome = outcome;
    expect(await fake.send(request())).toEqual(expected);
  });

  it('counts the call and records the request it received', async () => {
    const fake = new FakePushChannel(() => NOW);
    const sent = request();
    await fake.send(sent);
    expect(fake.calls).toBe(1);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toBe(sent);
  });

  it('expires without counting a call', async () => {
    const fake = new FakePushChannel(() => NOW);
    const result = await fake.send(request({ deadline: new Date(NOW.getTime()) }));
    expect(result).toEqual({ kind: 'expired' });
    expect(fake.calls).toBe(0);
    // الطلب اللي انتهت مهلته بيتسجل عشان يتشخّص، بس ما اتنفذش.
    expect(fake.requests).toHaveLength(1);
  });

  it('throws and still counts the call on a crash', async () => {
    const fake = new FakePushChannel(() => NOW);
    fake.outcome = 'crash';
    await expect(fake.send(request())).rejects.toThrow('FAKE_EXECUTION_CRASH');
    expect(fake.calls).toBe(1);
  });
});

describe('the hooks of the fake push channel', () => {
  it('runs the hooks around the submission', async () => {
    const order: string[] = [];
    const fake = new FakePushChannel(() => NOW, {
      beforeSubmission: () => {
        order.push('before');
      },
      afterSubmission: () => {
        order.push('after');
      },
    });
    await fake.send(request());
    expect(order).toEqual(['before', 'after']);
  });
});
