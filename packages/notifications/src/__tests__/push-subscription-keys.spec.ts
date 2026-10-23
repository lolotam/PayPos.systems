import { createECDH, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isValidSubscriptionKeys } from '../push/subscription-keys.ts';

// مفتاح عام حقيقي من زوج مفاتيح P-256: نقطة على المنحنى، زي ما المتصفح بيطلبه.
const realP256dh = (): string => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey().toString('base64url');
};
const realAuth = (): string => randomBytes(16).toString('base64url');
// نقطة خارج المنحنى: بادئة صحّية بس إحداثياتها مش على المنحنى.
const offCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
// نقطة مضغوطة: بادئة 0x03 مش 0x04.
const compressed = Buffer.concat([Buffer.from([0x03]), Buffer.alloc(64, 7)]).toString('base64url');

describe('isValidSubscriptionKeys', () => {
  it('accepts a real key pair', () => {
    expect(isValidSubscriptionKeys(realP256dh(), realAuth())).toBe(true);
  });

  it('refuses a public key that is not an uncompressed point on the curve', () => {
    for (const p256dh of [
      'A'.repeat(87),
      offCurve,
      compressed,
      'A'.repeat(86),
      'A'.repeat(88),
      `${'A'.repeat(86)}+`,
      '',
    ])
      expect(isValidSubscriptionKeys(p256dh, realAuth()), p256dh).toBe(false);
  });

  it('refuses an auth secret that is not sixteen bytes', () => {
    const p256dh = realP256dh();
    for (const auth of [
      'A'.repeat(21),
      'A'.repeat(23),
      `${'A'.repeat(21)}+`,
      `${'A'.repeat(21)}/`,
      '',
    ])
      expect(isValidSubscriptionKeys(p256dh, auth), auth).toBe(false);
  });

  it('never throws on a broken key', () => {
    expect(() => isValidSubscriptionKeys('not a key', 'not a key')).not.toThrow();
  });
});
