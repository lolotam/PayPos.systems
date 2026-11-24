import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createResendEventDigest,
  readResendWebhookConfiguration,
  resendBounceClass,
  resendSigningKey,
  verifyResendSignature,
} from '../resend-webhook.ts';

const secret = ['whsec', Buffer.from('resend-webhook-secret').toString('base64')].join('_');
// مفتاح التوقيع المتوقع، مشتغل مستقل عن resendSigningKey: الـ fixture ده هو المرجع اللي بنقارن عليه.
const expectedKeyOf = (secret: string): Buffer =>
  Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
const bareSecret = Buffer.from('resend-webhook-secret').toString('base64');
const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const body = Buffer.from('{"type":"email.bounced","created_at":"2026-11-23T10:00:00.000Z"}');
const now = new Date('2026-11-23T10:00:30.000Z');
const seconds = Math.floor(now.getTime() / 1000);

const sign = (messageId: string, timestamp: string, payload: Buffer) =>
  `v1,${createHmac('sha256', expectedKeyOf(secret))
    .update(`${messageId}.${timestamp}.`)
    .update(payload)
    .digest('base64')}`;

describe('resend webhook signature', () => {
  it('accepts a signature over the raw body and the id and timestamp', () => {
    const timestamp = String(seconds);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp, signature: sign(id, timestamp, body) },
        secret,
        now,
      ),
    ).toBe(true);
  });
  it('rejects a wrong secret, a changed body and a wrong id', () => {
    const timestamp = String(seconds);
    const signature = sign(id, timestamp, body);
    const other = ['whsec', Buffer.from('a-different-secret').toString('base64')].join('_');
    expect(verifyResendSignature(body, { id, timestamp, signature }, other, now)).toBe(false);
    expect(
      verifyResendSignature(
        Buffer.from('{"type":"email.bounced"}'),
        { id, timestamp, signature },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyResendSignature(body, { id: 'msg_other', timestamp, signature }, secret, now),
    ).toBe(false);
  });
  it('rejects a stale or a future timestamp outside the five minute window', () => {
    const stale = String(seconds - 301);
    const future = String(seconds + 301);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp: stale, signature: sign(id, stale, body) },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp: future, signature: sign(id, future, body) },
        secret,
        now,
      ),
    ).toBe(false);
    const edge = String(seconds - 299);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp: edge, signature: sign(id, edge, body) },
        secret,
        now,
      ),
    ).toBe(true);
  });
});

describe('resend webhook signature list and header shape', () => {
  it('accepts any matching v1 signature in the list and ignores the other versions', () => {
    const timestamp = String(seconds);
    const valid = sign(id, timestamp, body);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp, signature: `v2,${Buffer.from('other').toString('base64')} ${valid}` },
        secret,
        now,
      ),
    ).toBe(true);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp, signature: `v2,${Buffer.from('other').toString('base64')}` },
        secret,
        now,
      ),
    ).toBe(false);
  });
  it('refuses a comma-joined pair, an unpadded or a non-canonical signature value', () => {
    const timestamp = String(seconds);
    const valid = sign(id, timestamp, body).slice('v1,'.length);
    const verify = (signature: string) =>
      verifyResendSignature(body, { id, timestamp, signature }, secret, now);
    expect(verify(`v1,${valid},v1,${valid}`)).toBe(false);
    expect(verify(`v1,${valid}`)).toBe(true);
    expect(verify(`v1,${valid}A`)).toBe(false);
  });
});

describe('resend webhook secret forms', () => {
  it('accepts a bare base64 secret without the whsec_ prefix', () => {
    const timestamp = String(seconds);
    const signature = sign(id, timestamp, body);
    expect(verifyResendSignature(body, { id, timestamp, signature }, bareSecret, now)).toBe(true);
  });
  it('refuses a missing, repeated or malformed header', () => {
    const timestamp = String(seconds);
    const valid = sign(id, timestamp, body);
    expect(
      verifyResendSignature(body, { id: undefined, timestamp, signature: valid }, secret, now),
    ).toBe(false);
    expect(
      verifyResendSignature(body, { id, timestamp: undefined, signature: valid }, secret, now),
    ).toBe(false);
    expect(verifyResendSignature(body, { id, timestamp, signature: undefined }, secret, now)).toBe(
      false,
    );
    expect(
      verifyResendSignature(body, { id, timestamp, signature: 'not-a-signature' }, secret, now),
    ).toBe(false);
    expect(
      verifyResendSignature(
        body,
        { id, timestamp, signature: `v1,${'A'.repeat(43)}=` },
        secret,
        now,
      ),
    ).toBe(false);
  });
});

describe('resend event digest, bounce class and secret', () => {
  it('gives the same digest for a replayed event and a different one for another event', () => {
    const digest = createResendEventDigest(expectedKeyOf(secret));
    expect(digest(id)).toEqual(digest(id));
    expect(digest(id)).not.toEqual(digest('msg_other'));
    expect(digest(id)).toHaveLength(32);
  });
  it('keeps the digest independent of the signing secret', () => {
    const rotated = ['whsec', Buffer.from('a-rotated-webhook-secret').toString('base64')].join('_');
    expect(createResendEventDigest(expectedKeyOf(rotated))(id)).not.toEqual(
      createResendEventDigest(expectedKeyOf(secret))(id),
    );
    const digestKey = Buffer.alloc(32, 7);
    expect(createResendEventDigest(digestKey)(id)).toEqual(createResendEventDigest(digestKey)(id));
    expect(createResendEventDigest(digestKey)(id)).not.toEqual(
      createResendEventDigest(expectedKeyOf(secret))(id),
    );
  });
  it('classifies only a permanent bounce as suppressing, and leaves the rest unknown', () => {
    expect(resendBounceClass('Permanent')).toBe('PERMANENT');
    expect(resendBounceClass('permanent')).toBe('PERMANENT');
    expect(resendBounceClass('Transient')).toBe('TRANSIENT');
    expect(resendBounceClass('Temporary')).toBe('TRANSIENT');
    expect(resendBounceClass('Undetermined')).toBeNull();
    expect(resendBounceClass(undefined)).toBeNull();
    expect(resendBounceClass('anything else')).toBeNull();
  });
  it('refuses a missing or an unusable secret and a missing digest key', () => {
    expect(() => readResendWebhookConfiguration({})).toThrow('RESEND_WEBHOOK_CONFIG_INVALID');
    expect(() => readResendWebhookConfiguration({ RESEND_WEBHOOK_SECRET: '' })).toThrow(
      'RESEND_WEBHOOK_CONFIG_INVALID',
    );
    expect(() => resendSigningKey('whsec_short')).toThrow('RESEND_WEBHOOK_SECRET_INVALID');
    expect(() => readResendWebhookConfiguration({ RESEND_WEBHOOK_SECRET: secret })).toThrow(
      'RESEND_EVENT_DIGEST_KEY_INVALID',
    );
    expect(() =>
      readResendWebhookConfiguration({
        RESEND_WEBHOOK_SECRET: secret,
        RESEND_EVENT_DIGEST_KEY: 'short',
      }),
    ).toThrow('RESEND_EVENT_DIGEST_KEY_INVALID');
    expect(() =>
      readResendWebhookConfiguration({
        RESEND_WEBHOOK_SECRET: secret,
        RESEND_EVENT_DIGEST_KEY: 'r'.repeat(32),
      }),
    ).not.toThrow();
  });
});

it('rejects an oversized signature header even when it contains a valid signature', () => {
  const timestamp = String(seconds);
  const signature = sign(id, timestamp, body);
  expect(
    verifyResendSignature(
      body,
      { id, timestamp, signature: signature.padEnd(512, ' ') },
      secret,
      now,
    ),
  ).toBe(true);
  expect(
    verifyResendSignature(
      body,
      { id, timestamp, signature: signature.padEnd(513, ' ') },
      secret,
      now,
    ),
  ).toBe(false);
});
