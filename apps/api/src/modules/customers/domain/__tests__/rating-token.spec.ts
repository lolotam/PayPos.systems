import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseRatingToken } from '../rating-token.ts';

const COMPANY = '01920000-0000-7000-8000-000000000aa1';
// 43 حرفاً بترميز base64url، وآخر حرف فيها ('A') قيمته من مضاعفات 4 فبقت البتّين الأخيرين صفر.
const SECRET = 'A'.repeat(43);
const TOKEN = `${COMPANY}.${SECRET}`;

describe('the rating token parser', () => {
  it('accepts the canonical token and returns the company and the canonical form', () => {
    expect(parseRatingToken(TOKEN)).toEqual({ companyId: COMPANY, canonical: TOKEN });
  });

  it.each([
    ['an uppercase company', `${COMPANY.toUpperCase()}.${SECRET}`],
    ['a braced company', `{${COMPANY}}.${SECRET}`],
    ['an unhyphenated company', `${COMPANY.replaceAll('-', '')}.${SECRET}`],
    ['a 42-character secret', `${COMPANY}.${'A'.repeat(42)}`],
    ['a 44-character secret', `${COMPANY}.${'A'.repeat(44)}`],
    ['two dots', `${COMPANY}.${SECRET}.${SECRET}`],
    ['no dot', COMPANY],
    ['an empty token', ''],
    ['a space inside', `${COMPANY}.${'A'.repeat(20)} ${'A'.repeat(22)}`],
    ['a trailing space', `${TOKEN} `],
    ['a padded secret', `${COMPANY}.${'A'.repeat(42)}=`],
    ['a plus in the secret', `${COMPANY}.${'A'.repeat(20)}+${'A'.repeat(22)}`],
    ['a slash in the secret', `${COMPANY}.${'A'.repeat(20)}/${'A'.repeat(22)}`],
    ['a secret with non-zero tail bits', `${COMPANY}.${'A'.repeat(42)}B`],
  ])('refuses %s', (_case, raw) => {
    expect(parseRatingToken(raw)).toBeNull();
  });

  it('accepts every tail character whose two low bits are zero', () => {
    for (const last of 'AEIMQUYcgkosw048') {
      expect(parseRatingToken(`${COMPANY}.${'A'.repeat(42)}${last}`)).not.toBeNull();
    }
  });

  it('accepts the 59b-1 codec output and hashes its unchanged canonical form', () => {
    const token =
      '01920000-0000-7000-8000-000000000aa1.0vTCG98_ToLWpgP2Io1UPqhPnhupQiM1NPT_jzG3ZtM';
    const parsed = parseRatingToken(token);
    expect(parsed).toEqual({ companyId: COMPANY, canonical: token });
    if (parsed === null) throw new Error('59b-1 codec output rejected');
    expect(createHash('sha256').update(parsed.canonical, 'utf8').digest('hex')).toBe(
      'c5e494144058c381fe035fcf464738a744baf69bc6a3caafddfba1bea58e4bdd',
    );
  });
});
