import { describe, expect, it } from 'vitest';

import { createPhoneIdentity, phoneLockKey } from '../phone-identity.ts';

const hasher = createPhoneIdentity('test-phone-hash-key-not-for-production', 'test-v1');
describe('platform phone identity', () => {
  it('is stable without company id, has 32 bytes and last3, and uses the same lock key', () => {
    const first = hasher.identify('+96500000001');
    const second = hasher.identify('+96500000001');
    expect(first.hash).toEqual(second.hash);
    expect(first.hash).toHaveLength(32);
    expect(first.last3).toBe('001');
    expect(phoneLockKey(first.hash)).toBe(phoneLockKey(second.hash));
    expect(hasher.matches('+96500000001', first)).toBe(true);
    expect(hasher.matches('+96500000002', first)).toBe(false);
    expect(hasher.matches('+96500000001', { ...first, last3: '999' })).toBe(false);
    expect(hasher.matches('+96500000001', { ...first, hashKeyId: 'other' })).toBe(false);
  });
  it.each(['96500000001', '+096500000001', 'invalid', '+965 00000001'])(
    'rejects non-canonical input %s',
    (phone) => {
      expect(hasher.identify(phone).valid).toBe(false);
    },
  );
});
