import { createHmac, timingSafeEqual } from 'node:crypto';
import { NOTIFICATION_HASH_KEY_ID } from './identifier-patterns.ts';
import type { PhoneIdentity } from './phone-identity.ts';

const LOCAL = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

export function canonicalEmail(value: string): string | null {
  const parts = value.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain || value.length > 254 || local.length > 64)
    return null;
  return LOCAL.test(local) && DOMAIN.test(domain) ? `${local}@${domain.toLowerCase()}` : null;
}

export function createEmailIdentity(key: string, keyId: string) {
  if (key.length < 32 || !NOTIFICATION_HASH_KEY_ID.test(keyId))
    throw new Error('EMAIL_HASH_CONFIG_INVALID');
  const identify = (email: string): PhoneIdentity => {
    const canonical = canonicalEmail(email);
    return {
      hash: createHmac('sha256', key)
        .update('pospay:notifications:email:v1\0')
        .update(canonical ?? email)
        .digest(),
      hashKeyId: keyId,
      last3: '',
      valid: canonical !== null && canonical === email,
    };
  };
  return {
    identify,
    matches(email: string, identity: PhoneIdentity): boolean {
      const computed = identify(email);
      return (
        computed.valid &&
        identity.hashKeyId === keyId &&
        identity.last3 === '' &&
        identity.hash.length === computed.hash.length &&
        timingSafeEqual(computed.hash, identity.hash)
      );
    },
  };
}
