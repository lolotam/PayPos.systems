import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createProviderMessageDigest,
  verifyWhatsappSignature,
  verifyWhatsappToken,
} from '../provider-message-identity.ts';
import { createPhoneIdentity } from '../phone-identity.ts';
import { readWhatsappWebhookConfiguration } from '../webhook-configuration.ts';

const key = 'test-secret'.repeat(4);
const providerId = `test.${Buffer.from('+96500000001').toString('base64')}`;

describe('provider message identity and verification', () => {
  it('HMACs the complete phone-bearing synthetic id deterministically, without normalization', () => {
    const digest = createProviderMessageDigest(key, 'test-v1');
    expect(digest(providerId)).toEqual(
      createHmac('sha256', key)
        .update('pospay:notifications:provider-message:v1\0')
        .update(providerId)
        .digest(),
    );
    expect(digest(providerId)).toEqual(digest(providerId));
    for (const changed of [` ${providerId}`, providerId.toUpperCase(), `${providerId}x`])
      expect(digest(changed)).not.toEqual(digest(providerId));
    expect(digest('+96500000001')).not.toEqual(
      createPhoneIdentity(key, 'test-v1').identify('+96500000001').hash,
    );
  });
  it('checks raw bytes and rejects signature ambiguity', () => {
    const bytes = Buffer.from('{ "test": true }');
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(bytes).digest('hex')}`;
    expect(verifyWhatsappSignature(bytes, signature, 'test-secret')).toBe(true);
    expect(verifyWhatsappSignature(Buffer.from('{"test":true}'), signature, 'test-secret')).toBe(
      false,
    );
    for (const invalid of [
      undefined,
      [signature, signature],
      `${signature},${signature}`,
      'sha256=bad',
    ])
      expect(verifyWhatsappSignature(bytes, invalid, 'test-secret')).toBe(false);
    expect(verifyWhatsappToken('test-secret', 'test-secret')).toBe(true);
    expect(verifyWhatsappToken('invalid', 'test-secret')).toBe(false);
  });
  it('missing/faulty keys fail without returning input', () => {
    expect(() => createProviderMessageDigest('', 'test-v1')).toThrow(
      'NOTIFICATION_MESSAGE_HASH_CONFIG_INVALID',
    );
    expect(() => readWhatsappWebhookConfiguration({})).toThrow('WHATSAPP_CONFIG_INVALID');
  });
});
