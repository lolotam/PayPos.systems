import { describe, expect, it } from 'vitest';

import { deviceCheckCode, deviceRegistration, PAIRING_CODE_ALPHABET } from '../identity/devices.js';

// كود المطابقة 4 حروف من أبجدية كود الربط، والحساب نفسه في packages/domain.

const uuid = '01920000-0000-7000-8000-000000000001';

describe('the check code schema', () => {
  it('uses an alphabet with no look-alikes', () => {
    expect(PAIRING_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (const character of '01ILO') expect(PAIRING_CODE_ALPHABET).not.toContain(character);
  });

  it('accepts four characters of the alphabet', () => {
    expect(deviceCheckCode.safeParse('ABCD').success).toBe(true);
    expect(deviceCheckCode.safeParse('K7QP').success).toBe(true);
  });

  it('rejects a look-alike character, a wrong case and a wrong length', () => {
    for (const bad of ['ABC0', 'ABCI', 'ABCL', 'abcd', 'ABC', 'ABCDE']) {
      expect(deviceCheckCode.safeParse(bad).success).toBe(false);
    }
  });
});

describe('the device registration schema', () => {
  const valid = { company_id: uuid, device_id: uuid, claim_secret: 's', check_code: 'K7QP' };

  it('requires a valid check code', () => {
    expect(deviceRegistration.safeParse(valid).success).toBe(true);
    expect(deviceRegistration.safeParse({ ...valid, check_code: 'K7Q0' }).success).toBe(false);
    expect(deviceRegistration.safeParse({ ...valid, check_code: undefined }).success).toBe(false);
  });
});
