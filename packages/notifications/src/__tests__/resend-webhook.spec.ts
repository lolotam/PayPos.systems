import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createResendEventDigest,
  readResendWebhookConfiguration,
  resendBounceClass,
  resendSigningKey,
  verifyResendSignature,
} from '../resend-webhook.ts';

const secret = `whsec_${Buffer.from('resend-webhook-secret').toString('base64')}`;
const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const body = Buffer.from('{"type":"email.bounced","created_at":"2026-11-23T10:00:00.000Z"}');
const now = new Date('2026-11-23T10:00:30.000Z');
const seconds = Math.floor(now.getTime() / 1000);

const sign = (messageId: string, timestamp: string, payload: Buffer) =>
  `v1,${createHmac('sha256', resendSigningKey(secret))
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
    expect(
      verifyResendSignature(body, { id, timestamp, signature }, `${secret}x`, now),
    ).toBe(false);
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
  it('refuses a missing, repeated or malformed header', () => {
    const timestamp = String(seconds);
    const valid = sign(id, timestamp, body);
    expect(
      verifyResendSignature(body, { id: undefined, timestamp, signature: valid }, secret, now),
    ).toBe(false);
    expect(
      verifyResendSignature(body, { id, timestamp: undefined, signature: valid }, secret, now),
    ).toBe(false);
    expect(
      verifyResendSignature(body, { id, timestamp, signature: undefined }, secret, now),
    ).toBe(false);
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
    const digest = createResendEventDigest(resendSigningKey(secret));
    expect(digest(id)).toEqual(digest(id));
    expect(digest(id)).not.toEqual(digest('msg_other'));
    expect(digest(id)).toHaveLength(32);
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
  it('refuses a missing or an unusable secret', () => {
    expect(() => readResendWebhookConfiguration({})).toThrow('RESEND_WEBHOOK_CONFIG_INVALID');
    expect(() => readResendWebhookConfiguration({ RESEND_WEBHOOK_SECRET: '' })).toThrow(
      'RESEND_WEBHOOK_CONFIG_INVALID',
    );
    expect(() => resendSigningKey('whsec_short')).toThrow('RESEND_WEBHOOK_SECRET_INVALID');
    expect(() =>
      readResendWebhookConfiguration({ RESEND_WEBHOOK_SECRET: secret }),
    ).not.toThrow();
  });
});
