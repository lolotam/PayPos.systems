import { describe, expect, it } from 'vitest';

import {
  formatDeviceToken,
  hashDeviceSecret,
  newDeviceSecret,
  parseDeviceToken,
  verifyDeviceSecret,
} from '../device-credentials.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const DEVICE = '01920000-0000-7000-8000-0000000000d1';

describe('device credentials', () => {
  it('a new secret is 32 random bytes, and only its hash is stored', () => {
    const secret = newDeviceSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newDeviceSecret()).not.toBe(secret);
    const hash = hashDeviceSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret);
  });

  it('verifies the right secret and refuses a wrong one, a missing hash or a malformed hash', () => {
    const secret = newDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(verifyDeviceSecret(secret, hash)).toBe(true);
    expect(verifyDeviceSecret(newDeviceSecret(), hash)).toBe(false);
    expect(verifyDeviceSecret(secret, null)).toBe(false);
    expect(verifyDeviceSecret(secret, 'not-a-hash')).toBe(false);
  });

  it('round-trips the token and refuses any other shape', () => {
    const secret = newDeviceSecret();
    const token = formatDeviceToken({ companyId: COMPANY, deviceId: DEVICE, secret });
    expect(parseDeviceToken(token)).toEqual({ companyId: COMPANY, deviceId: DEVICE, secret });
    for (const bad of [
      '',
      token.replace('pd_', 'px_'),
      `pd_not-a-uuid.${DEVICE}.${secret}`,
      `pd_${COMPANY}.${DEVICE}.short`,
      `${token}.extra`,
    ]) {
      expect(parseDeviceToken(bad)).toBeNull();
    }
  });
});
