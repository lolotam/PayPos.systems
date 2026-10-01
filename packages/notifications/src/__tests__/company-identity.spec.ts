import { describe, expect, it } from 'vitest';

import { createPhoneIdentity, phoneLockKey } from '../phone-identity.ts';

const hasher = createPhoneIdentity('test-phone-hash-key-not-for-production', 'test-v1');

describe('cross-company recipient hash consistency', () => {
  it('computes identical recipient hash and lock key for the same phone in two companies', () => {
    const companyA = '01920000-0000-7000-8000-0000000000a0';
    const companyB = '01920000-0000-7000-8000-0000000000b0';
    expect(companyA).not.toBe(companyB);

    const phone = '+96500000001';
    const identityA = hasher.identify(phone);
    const identityB = hasher.identify(phone);

    expect(identityA.hash).toEqual(identityB.hash);
    expect(identityA.last3).toBe('001');
    expect(identityB.last3).toBe('001');
    expect(phoneLockKey(identityA.hash)).toBe(phoneLockKey(identityB.hash));

    expect(hasher.matches(phone, identityA)).toBe(true);
    expect(hasher.matches(phone, identityB)).toBe(true);
  });
});
