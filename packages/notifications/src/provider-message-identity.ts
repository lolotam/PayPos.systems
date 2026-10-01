import { NOTIFICATION_HASH_KEY_ID } from './identifier-patterns.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function createProviderMessageDigest(key: string, keyId: string) {
  if (key.length < 32 || !NOTIFICATION_HASH_KEY_ID.test(keyId))
    throw new Error('NOTIFICATION_MESSAGE_HASH_CONFIG_INVALID');
  return (completeId: string): Buffer => {
    if (completeId.length === 0 || completeId.length > 2048)
      throw new Error('NOTIFICATION_MESSAGE_ID_INVALID');
    try {
      return createHmac('sha256', key)
        .update('pospay:notifications:provider-message:v1\0')
        .update(completeId, 'utf8')
        .digest();
    } catch {
      throw new WhatsappDigestUnavailableError();
    }
  };
}

export function verifyWhatsappSignature(body: Buffer, signature: unknown, secret: string): boolean {
  if (
    typeof signature !== 'string' ||
    !/^sha256=[a-fA-F0-9]{64}$/.test(signature) ||
    secret.length === 0
  )
    return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function verifyWhatsappToken(actual: string, expected: string): boolean {
  const left = createHmac('sha256', expected).update(actual).digest();
  const right = createHmac('sha256', expected).update(expected).digest();
  return expected.length > 0 && timingSafeEqual(left, right);
}

export class WhatsappDigestUnavailableError extends Error {
  constructor() {
    super('WHATSAPP_DIGEST_UNAVAILABLE');
    this.name = 'WhatsappDigestUnavailableError';
  }
}
