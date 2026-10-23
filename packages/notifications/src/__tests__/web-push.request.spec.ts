import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { request as httpsRequest } from 'node:https';

import { expect, it } from 'vitest';

import { WebPushChannel } from '../adapters/web-push.channel.ts';
import type { PushRequest, PushResult } from '../push/channel.ts';
import { generateVapidKeyPair } from '../push/vapid-keys.ts';

const NOW = new Date('2026-10-23T10:00:00Z');
const SUBJECT = 'mailto:ops@pospay.systems';
const TOPIC = 'abcdefghijklmnopqrstuvwxyz012345';
const PAYLOAD =
  '{"v":1,"title":"x","body":"y","tag":"z","url":"/personal","lang":"en","t":"synthetic"}';

const vapid = generateVapidKeyPair();

interface FakeCall {
  readonly url: string;
  readonly headers: Record<string, string | number | undefined>;
  readonly body: Buffer;
}

// رأس الطلب بتيجي بأسماء capitalized من المكتبة؛ البحث بيقارن بالحروف الصغيرة.
function header(call: FakeCall | undefined, name: string): string | number | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(call?.headers ?? {}))
    if (key.toLowerCase() === wanted) return value;
  return undefined;
}

// طلب وهمية: بترد برمز حالة من غير شبكة، أو ما بتردش خالص.
function fakeRequest(status: number | null) {
  const calls: FakeCall[] = [];
  const request = ((
    url: string,
    options: { headers?: Record<string, string | number | undefined> },
    callback: (response: IncomingMessage) => void,
  ) => {
    const emitter = new EventEmitter() as EventEmitter & {
      write: (chunk: Buffer) => void;
      end: () => void;
    };
    const chunks: Buffer[] = [];
    emitter.write = (chunk: Buffer) => {
      chunks.push(chunk);
    };
    emitter.end = () => {
      calls.push({ url, headers: options.headers ?? {}, body: Buffer.concat(chunks) });
      if (status === null) return;
      const response = new EventEmitter() as unknown as IncomingMessage;
      response.statusCode = status;
      response.destroy = (): IncomingMessage => {
        response.emit('close');
        return response;
      };
      callback(response);
    };
    return emitter;
  }) as unknown as typeof httpsRequest;
  return { calls, request };
}

const subscription = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
};

const request = (over: Partial<PushRequest> = {}): PushRequest => ({
  target: subscription(),
  payload: PAYLOAD,
  ttlSeconds: 3600,
  urgency: 'high',
  topic: TOPIC,
  deadline: null,
  ...over,
});

const channel = (request: typeof httpsRequest, options: { timeoutMs?: number } = {}) =>
  new WebPushChannel({
    vapid: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    now: () => NOW,
    request,
    ...options,
  });

const ROWS: [number, PushResult][] = [
  [201, { kind: 'accepted', httpStatus: 201 }],
  [410, { kind: 'gone', httpStatus: 410 }],
  [404, { kind: 'gone', httpStatus: 404 }],
  [400, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 400, vapidRejected: false }],
  [401, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 401, vapidRejected: true }],
  [403, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 403, vapidRejected: true }],
  [413, { kind: 'rejected', code: 'PROVIDER_4XX', httpStatus: 413, vapidRejected: false }],
  [429, { kind: 'rejected', code: 'PROVIDER_429', httpStatus: 429, vapidRejected: false }],
  [500, { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: 500 }],
];

it.each(ROWS)('maps the answer %s of the real sender', async (status, expected) => {
  const fake = fakeRequest(status);
  expect(await channel(fake.request).send(request())).toEqual(expected);
  expect(fake.calls).toHaveLength(1);
});

it('never follows a redirect', async () => {
  const fake = fakeRequest(302);
  expect(await channel(fake.request).send(request())).toEqual({
    kind: 'unknown',
    code: 'NETWORK_UNKNOWN',
    outcomeKnown: false,
    httpStatus: 302,
  });
  expect(fake.calls).toHaveLength(1);
});

it('aborts a request that never answers', async () => {
  const fake = fakeRequest(null);
  const result = await channel(fake.request, { timeoutMs: 20 }).send(request());
  expect(result).toEqual({
    kind: 'unknown',
    code: 'NETWORK_UNKNOWN',
    outcomeKnown: false,
    httpStatus: null,
  });
  expect(fake.calls).toHaveLength(1);
});

it('sends one signed and encrypted request with the topic and the urgency', async () => {
  const fake = fakeRequest(201);
  await channel(fake.request).send(request());
  expect(fake.calls).toHaveLength(1);
  const call = fake.calls[0];
  expect(header(call, 'authorization')).toBeDefined();
  expect(header(call, 'urgency')).toBe('high');
  expect(header(call, 'topic')).toBe(TOPIC);
  expect(Number(header(call, 'ttl'))).toBe(3600);
  expect(call?.body.length).toBeGreaterThan(0);
});

it('recomputes the ttl from the time left to the deadline', async () => {
  const fake = fakeRequest(201);
  const result = await channel(fake.request).send(
    request({ deadline: new Date(NOW.getTime() + 30_000) }),
  );
  expect(result).toEqual({ kind: 'accepted', httpStatus: 201 });
  expect(Number(header(fake.calls[0], 'ttl'))).toBe(30);
});

it('refuses a malformed key before any request is made', async () => {
  const fake = fakeRequest(201);
  const offCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
  const result = await channel(fake.request).send(
    request({ target: { ...subscription(), p256dh: offCurve } }),
  );
  expect(result).toEqual({ kind: 'refused', code: 'CAPABILITY_UNAVAILABLE' });
  expect(fake.calls).toHaveLength(0);
});

it('never carries the endpoint, the keys or the payload in the result', async () => {
  const fake = fakeRequest(201);
  const sent = request();
  const result = await channel(fake.request).send(sent);
  const text = JSON.stringify(result);
  for (const secret of [
    sent.target.endpoint,
    sent.target.p256dh,
    sent.target.auth,
    sent.payload,
    vapid.privateKey,
  ])
    expect(text, secret).not.toContain(secret);
});
