import { describe, expect, it } from 'vitest';

import { totpSecret } from './totp-secret';

describe('totpSecret', () => {
  it('extracts secret parameter from a valid otpauth URI', () => {
    const uri =
      'otpauth://totp/PosPay:admin@pospay.systems?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=PosPay';
    expect(totpSecret(uri)).toBe('HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ');
  });

  it('returns undefined when URI is missing secret parameter or contains garbage', () => {
    expect(totpSecret('otpauth://totp/PosPay:admin@pospay.systems?issuer=PosPay')).toBeUndefined();
    expect(totpSecret('')).toBeUndefined();
    expect(totpSecret('garbage-string-not-a-url')).toBeUndefined();
    expect(totpSecret('https://example.com/some/path')).toBeUndefined();
  });
});
