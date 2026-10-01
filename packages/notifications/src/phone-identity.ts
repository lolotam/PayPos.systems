import { NOTIFICATION_HASH_KEY_ID } from './identifier-patterns.ts';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const E164 = /^\+[1-9]\d{7,14}$/;
const DOMAIN = 'pospay:notifications:phone:v1\0';

export interface PhoneIdentity {
  readonly hash: Uint8Array;
  readonly hashKeyId: string;
  readonly last3: string;
  readonly valid: boolean;
}

export function createPhoneIdentity(key: string, keyId: string) {
  if (key.length < 32 || !NOTIFICATION_HASH_KEY_ID.test(keyId)) {
    throw new Error('NOTIFICATION_HASH_CONFIG_INVALID');
  }
  const identify = (phone: string): PhoneIdentity => ({
    hash: createHmac('sha256', key).update(DOMAIN).update(phone).digest(),
    hashKeyId: keyId,
    last3: phone.replace(/\D/g, '').slice(-3).padStart(3, '0'),
    valid: E164.test(phone),
  });
  return {
    identify,
    matches(phone: string, identity: PhoneIdentity): boolean {
      const computed = identify(phone);
      return (
        computed.valid &&
        identity.hashKeyId === keyId &&
        identity.last3 === computed.last3 &&
        identity.hash.length === computed.hash.length &&
        timingSafeEqual(computed.hash, identity.hash)
      );
    },
  };
}

export function phoneLockKey(hash: Uint8Array): bigint {
  return createHash('sha256')
    .update('pospay:notifications:phone-lock:v1\0')
    .update(hash)
    .digest()
    .readBigInt64BE();
}
