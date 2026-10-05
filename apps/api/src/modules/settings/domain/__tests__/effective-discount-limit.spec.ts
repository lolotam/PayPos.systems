import { describe, expect, it } from 'vitest';
import { resolveEffectiveDiscountLimit } from '../effective-discount-limit.ts';

describe('effective discount precedence', () => {
  for (const personal of [null, 0, 1234, 10000]) {
    for (const business of [null, 0, 500, 10000]) {
      it(`owner overrides person ${personal} and business ${business}`, () => {
        expect(
          resolveEffectiveDiscountLimit(
            { status: 'FOUND', owner: true, limit_bps: personal },
            business,
          ),
        ).toEqual({ status: 'UNLIMITED', source: 'OWNER' });
      });
      it(`person ${personal}, business ${business}`, () => {
        const limit = personal ?? business;
        expect(
          resolveEffectiveDiscountLimit(
            { status: 'FOUND', owner: false, limit_bps: personal },
            business,
          ),
        ).toEqual(
          limit === null
            ? { status: 'NOT_CONFIGURED' }
            : {
                status: 'SET',
                source: personal === null ? 'BUSINESS' : 'PERSON',
                limit_bps: limit,
              },
        );
      });
    }
  }
  it.each([null, 0, 10000])('missing member cannot inherit %s', (business) => {
    expect(resolveEffectiveDiscountLimit({ status: 'MEMBERSHIP_NOT_FOUND' }, business)).toEqual({
      status: 'MEMBERSHIP_NOT_FOUND',
    });
  });
  it.each([-1, 10001, 1.5, NaN, Infinity])('rejects invalid effective limit %s', (limit) => {
    expect(() =>
      resolveEffectiveDiscountLimit({ status: 'FOUND', owner: false, limit_bps: limit }, null),
    ).toThrow(RangeError);
    expect(() =>
      resolveEffectiveDiscountLimit({ status: 'FOUND', owner: false, limit_bps: null }, limit),
    ).toThrow(RangeError);
  });
});
