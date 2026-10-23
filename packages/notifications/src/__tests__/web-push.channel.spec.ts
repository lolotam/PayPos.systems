import { createECDH, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  WebPushChannel,
  type WebPushRequestOptions,
  type WebPushSender,
} from '../adapters/web-push.channel.ts';
import type { PushRequest, PushResult, PushTarget } from '../push/channel.ts';
import { generateVapidKeyPair } from '../push/vapid-keys.ts';

const NOW = new Date('2026-10-23T10:00:00Z');
const SUBJECT = 'mailto:ops@pospay.systems';
const PAYLOAD = '{"v":1,"title":"x","body":"y","tag":"z","url":"/personal","lang":"en","t":"t"}';
const vapid = generateVapidKeyPair();

interface Captured {
  readonly target: PushTarget;
  readonly payload: string;
  readonly options: WebPushRequestOptions;
}

const target = (): PushTarget => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-endpoint',
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
};

const request = (overrides: Partial<PushRequest> = {}): PushRequest => ({
  target: target(),
  payload: PAYLOAD,
  ttlSeconds: 3600,
  urgency: 'high',
  topic: 'topic-of-the-event',
  deadline: null,
  ...overrides,
});

const channel = (sender: WebPushSender): WebPushChannel =>
  new WebPushChannel({
    vapid: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    now: () => NOW,
    sender,
  });

const channelWithTimeout = (sender: WebPushSender, timeoutMs: number): WebPushChannel =>
  new WebPushChannel({
    vapid: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    now: () => NOW,
    timeoutMs,
    sender,
  });

const capture = (status = 201): { calls: Captured[]; sender: WebPushSender } => {
  const calls: Captured[] = [];
  const sender: WebPushSender = async (sent, payload, sentOptions) => {
    calls.push({ target: sent, payload, options: sentOptions });
    return { statusCode: status };
  };
  return { calls, sender };
};

const refusing =
  (status: number): WebPushSender =>
  async () => {
    throw Object.assign(new Error('the push service refused the request'), { statusCode: status });
  };

const thrownMessage = (build: () => unknown): string => {
  try {
    build();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('the request the channel sends', () => {
  it('sends one request with the ttl, the urgency, the topic, the timeout and the vapid details', async () => {
    const { calls, sender } = capture();
    const result = await channel(sender).send(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.TTL).toBe(3600);
    expect(calls[0]?.options.urgency).toBe('high');
    expect(calls[0]?.options.topic).toBe('topic-of-the-event');
    expect(calls[0]?.options.timeout).toBe(10_000);
    expect(calls[0]?.options.vapidDetails).toEqual({
      subject: SUBJECT,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    });
    expect(calls[0]?.payload).toBe(PAYLOAD);
    expect(result).toEqual({ kind: 'accepted', httpStatus: 201 });
  });

  it('keeps the timeout of the channel between one millisecond and ten seconds', async () => {
    const long = capture();
    await channelWithTimeout(long.sender, 30_000).send(request());
    expect(long.calls[0]?.options.timeout).toBe(10_000);
    const short = capture();
    await channelWithTimeout(short.sender, 0).send(request());
    expect(short.calls[0]?.options.timeout).toBe(1);
  });
});

describe('the accepted, gone and rejected answers', () => {
  const ACCEPTED: [number, PushResult][] = [
    [200, { kind: 'accepted', httpStatus: 200 }],
    [201, { kind: 'accepted', httpStatus: 201 }],
    [204, { kind: 'accepted', httpStatus: 204 }],
  ];
  const REFUSED: [number, PushResult][] = [
    [404, { kind: 'gone', httpStatus: 404 }],
    [410, { kind: 'gone', httpStatus: 410 }],
    [400, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 400, vapidRejected: false }],
    [401, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 401, vapidRejected: true }],
    [403, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 403, vapidRejected: true }],
    [413, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 413, vapidRejected: false }],
    [429, { kind: 'rejected', code: 'PROVIDER_429', httpStatus: 429, vapidRejected: false }],
  ];

  it.each(ACCEPTED)('accepts the answer %s', async (status, expected) => {
    const { sender } = capture(status);
    expect(await channel(sender).send(request())).toEqual(expected);
  });

  it.each(REFUSED)('maps the refused answer %s', async (status, expected) => {
    expect(await channel(refusing(status)).send(request())).toEqual(expected);
  });
});

describe('the unknown answers', () => {
  const UNKNOWN: [number, PushResult][] = [
    [500, { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: 500 }],
    [503, { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: 503 }],
    [302, { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: 302 }],
  ];

  it.each(UNKNOWN)('maps the unknown answer %s', async (status, expected) => {
    expect(await channel(refusing(status)).send(request())).toEqual(expected);
  });

  it('keeps a rejection without a status unknown', async () => {
    const sender: WebPushSender = async () => {
      throw new Error('socket hang up');
    };
    expect(await channel(sender).send(request())).toEqual({
      kind: 'unknown',
      code: 'NETWORK_UNKNOWN',
      outcomeKnown: false,
      httpStatus: null,
    });
  });

  it('keeps a timeout unknown', async () => {
    const sender: WebPushSender = async () => {
      throw Object.assign(new Error('Socket timeout'), { code: 'ETIMEDOUT' });
    };
    expect(await channel(sender).send(request())).toEqual({
      kind: 'unknown',
      code: 'NETWORK_UNKNOWN',
      outcomeKnown: false,
      httpStatus: null,
    });
  });

  it.each([99, 600, 1000])('keeps a status outside the stored range unknown', async (status) => {
    const accepted = capture(status);
    expect(await channel(accepted.sender).send(request())).toEqual({
      kind: 'unknown',
      code: 'NETWORK_UNKNOWN',
      outcomeKnown: false,
      httpStatus: null,
    });
    expect(await channel(refusing(status)).send(request())).toEqual({
      kind: 'unknown',
      code: 'NETWORK_UNKNOWN',
      outcomeKnown: false,
      httpStatus: null,
    });
  });
});

describe('the deadline and the timeout of the request', () => {
  it('expires without calling the sender when the deadline passed', async () => {
    const { calls, sender } = capture();
    const result = await channel(sender).send(request({ deadline: new Date(NOW.getTime()) }));
    expect(result).toEqual({ kind: 'expired' });
    expect(calls).toHaveLength(0);
  });

  it('clamps the timeout to the time left to the deadline', async () => {
    const { calls, sender } = capture();
    await channel(sender).send(request({ deadline: new Date(NOW.getTime() + 3_000) }));
    expect(calls[0]?.options.timeout).toBe(3_000);
  });
});

describe('the privacy of the result', () => {
  it('never carries the endpoint, the keys, the payload or the private key', async () => {
    const sent = request();
    const senders: WebPushSender[] = [
      capture().sender,
      refusing(404),
      refusing(429),
      refusing(503),
      async () => {
        throw new Error('socket hang up');
      },
    ];
    const results: PushResult[] = [];
    for (const sender of senders) results.push(await channel(sender).send(sent));
    const serialized = JSON.stringify(results);
    for (const secret of [
      sent.target.endpoint,
      sent.target.p256dh,
      sent.target.auth,
      sent.payload,
      vapid.privateKey,
    ])
      expect(serialized, secret).not.toContain(secret);
  });
});

describe('the configuration of the channel', () => {
  it('refuses a pair that does not match without naming a key', () => {
    const other = generateVapidKeyPair();
    const message = thrownMessage(
      () =>
        new WebPushChannel({
          vapid: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: other.privateKey },
          now: () => NOW,
        }),
    );
    expect(message).toBe('PUSH_PROVIDER_CONFIG_INVALID');
    expect(message).not.toContain(vapid.publicKey);
    expect(message).not.toContain(other.privateKey);
  });
});
