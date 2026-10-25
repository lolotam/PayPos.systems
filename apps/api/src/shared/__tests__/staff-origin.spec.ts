import { describe, expect, it } from 'vitest';

import { isStaffOrigin, staffNativeOriginsFrom } from '../staff-origin.token.ts';

const origins = {
  pos: 'https://pos.staging.pospay.systems',
  native: ['capacitor://localhost'],
};

describe('isStaffOrigin', () => {
  it('accepts the POS origin', () => {
    expect(isStaffOrigin(origins, origins.pos)).toBe(true);
  });

  it('accepts a configured native origin', () => {
    expect(isStaffOrigin(origins, 'capacitor://localhost')).toBe(true);
  });

  it('refuses an unknown origin', () => {
    expect(isStaffOrigin(origins, 'https://evil.example')).toBe(false);
  });

  it('refuses a missing Origin header', () => {
    expect(isStaffOrigin(origins, undefined)).toBe(false);
  });

  it('refuses when staff origins are not configured', () => {
    expect(isStaffOrigin(null, origins.pos)).toBe(false);
  });
});

describe('staffNativeOriginsFrom', () => {
  it('returns no origins when unset or empty', () => {
    expect(staffNativeOriginsFrom(undefined)).toEqual([]);
    expect(staffNativeOriginsFrom('')).toEqual([]);
  });

  it('accepts the iOS Capacitor origin', () => {
    expect(staffNativeOriginsFrom('capacitor://localhost')).toEqual(['capacitor://localhost']);
  });

  it('trims entries and drops a trailing empty entry', () => {
    expect(staffNativeOriginsFrom('capacitor://localhost, ')).toEqual(['capacitor://localhost']);
  });

  it.each(['https://evil.example', 'capacitor://other', 'CAPACITOR://LOCALHOST'])(
    'refuses %s',
    (value) => {
      expect(() => staffNativeOriginsFrom(value)).toThrow(
        'STAFF_NATIVE_ORIGINS accepts only capacitor://localhost',
      );
    },
  );
});
