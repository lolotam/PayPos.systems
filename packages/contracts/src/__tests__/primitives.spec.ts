import { describe, expect, it } from 'vitest';

import { errorEnvelope } from '../common/errors.js';
import { pageQuery } from '../common/pagination.js';
import { currency, nameAr, nameEn, timeZone } from '../common/primitives.js';

describe('names — 1 to 255 characters', () => {
  it('accepts 1 and 255 characters, rejects empty and 256', () => {
    expect(nameEn.safeParse('A').success).toBe(true);
    expect(nameAr.safeParse('ب'.repeat(255)).success).toBe(true);
    expect(nameEn.safeParse('').success).toBe(false);
    expect(nameEn.safeParse('   ').success).toBe(false);
    expect(nameEn.safeParse('a'.repeat(256)).success).toBe(false);
  });
});

describe('timezone', () => {
  it.each(['Asia/Kuwait', 'Asia/Riyadh', 'Europe/London', 'UTC'])('accepts %s', (zone) => {
    expect(timeZone.safeParse(zone).success).toBe(true);
  });

  it.each(['Kuwait', 'Asia/Atlantis', '+03:00', ''])('rejects %j', (zone) => {
    expect(timeZone.safeParse(zone).success).toBe(false);
  });
});

describe('currency — any ISO 4217 code', () => {
  it.each(['KWD', 'SAR', 'USD', 'JPY'])('accepts %s', (code) => {
    expect(currency.safeParse(code).success).toBe(true);
  });

  it.each(['kwd', 'KW', 'KWDD', 'ZZZ', ''])('rejects %j', (code) => {
    expect(currency.safeParse(code).success).toBe(false);
  });
});

describe('errorEnvelope', () => {
  it('accepts the bilingual envelope with optional details', () => {
    const base = {
      code: 'COMPANY_NOT_FOUND',
      message_ar: 'الشركة مش موجودة',
      message_en: 'Not found',
    };
    expect(errorEnvelope.safeParse(base).success).toBe(true);
    expect(errorEnvelope.safeParse({ ...base, details: { field: 'id' } }).success).toBe(true);
  });

  it('rejects a lower-case code or a missing language', () => {
    expect(
      errorEnvelope.safeParse({ code: 'nope', message_ar: 'x', message_en: 'x' }).success,
    ).toBe(false);
    expect(errorEnvelope.safeParse({ code: 'X', message_en: 'x' }).success).toBe(false);
  });
});

describe('pageQuery', () => {
  it('defaults the limit to 20 and coerces it from a query string', () => {
    expect(pageQuery.parse({})).toEqual({ limit: 20 });
    expect(pageQuery.parse({ limit: '50', cursor: 'abc' })).toEqual({ limit: 50, cursor: 'abc' });
  });

  it.each(['0', '101', '2.5', 'ten'])('rejects limit %j', (limit) => {
    expect(pageQuery.safeParse({ limit }).success).toBe(false);
  });
});
