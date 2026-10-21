import { describe, expect, it } from 'vitest';
import {
  buildDiscountTerms,
  canonicalDiscountTerms,
  discountTermsHash,
  type DiscountTermsInput,
  type DiscountTermsV1,
} from '../discount-terms.ts';
import { discountFromPercent } from '../session-pricing.ts';

const INPUT: DiscountTermsInput = {
  company_id: 'company-1',
  business_id: 'business-1',
  branch_id: 'branch-1',
  customer_id: 'customer-1',
  session_id: 'session-1',
  service_id: 'service-1',
  requested_by: 'user-1',
  requested_by_membership_id: 'membership-1',
  occurred_business_date: '2026-10-21',
  list_price: 25000n,
  price: 25000n,
  discount: 5000n,
  performer_ids: ['employee-2', 'employee-1', 'employee-2'],
};

// The real SHA-256 arrives with the adapter; the domain may not import node:crypto, so the test brings its own.
const fakeSha256 = (text: string): string => {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash.toString(16).padStart(8, '0').repeat(8);
};

const TERMS = buildDiscountTerms(INPUT);

const CHANGED_FIELDS: [string, unknown][] = [
  ['v', 2],
  ['company_id', 'company-2'],
  ['business_id', 'business-2'],
  ['branch_id', 'branch-2'],
  ['customer_id', 'customer-2'],
  ['session_id', 'session-2'],
  ['occurred_business_date', '2026-10-22'],
  ['service_id', 'service-2'],
  ['list_price', '25.001'],
  ['price', '24.000'],
  ['discount', '5.500'],
  ['net', '19.500'],
  ['effective_bps', 2001],
  ['performer_ids', ['employee-3']],
  ['requested_by', 'user-2'],
  ['requested_by_membership_id', 'membership-2'],
];

describe('the terms the approver saw: the line as it will be written', () => {
  it('stores the net and ceils the effective bps of the line', () => {
    const terms = buildDiscountTerms({ ...INPUT, list_price: 10000n, price: 10000n, discount: 1n });
    expect(terms.net).toBe('9.999');
    expect(terms.effective_bps).toBe(1);
  });

  it('ceils a third of the list price to the next basis point', () => {
    const terms = buildDiscountTerms({ ...INPUT, list_price: 3000n, price: 3000n, discount: 2000n });
    expect(terms.net).toBe('1.000');
    expect(terms.effective_bps).toBe(6667);
  });

  it('carries a percent discount through the shared half-up rounding', () => {
    const discount = discountFromPercent(7125n, 1000);
    const terms = buildDiscountTerms({ ...INPUT, list_price: 7125n, price: 7125n, discount });
    expect(terms.discount).toBe('0.713');
    expect(terms.net).toBe('6.412');
    expect(terms.effective_bps).toBe(1001);
  });

  it('reads a free list price and a net at or above the list price as no discount', () => {
    expect(buildDiscountTerms({ ...INPUT, list_price: 0n, price: 0n, discount: 0n }).effective_bps).toBe(0);
    expect(buildDiscountTerms({ ...INPUT, list_price: 25000n, price: 25000n, discount: 0n }).effective_bps).toBe(0);
    expect(buildDiscountTerms({ ...INPUT, list_price: 25000n, price: 30000n, discount: 0n }).effective_bps).toBe(0);
  });

  it('refuses a discount larger than the price', () => {
    expect(() => buildDiscountTerms({ ...INPUT, price: 1000n, discount: 1001n })).toThrow(
      'SESSION_DISCOUNT_INVALID',
    );
  });

  it('sorts the performers and drops the duplicates', () => {
    expect(TERMS.performer_ids).toEqual(['employee-1', 'employee-2']);
  });

  it('keeps a null session id null', () => {
    expect(buildDiscountTerms({ ...INPUT, session_id: null }).session_id).toBeNull();
  });

  it('stores every amount as a three-decimal string', () => {
    expect(TERMS.list_price).toBe('25.000');
    expect(TERMS.price).toBe('25.000');
    expect(TERMS.discount).toBe('5.000');
    expect(TERMS.net).toBe('20.000');
  });

  it('lowers every id so one uuid keeps one fingerprint', () => {
    const upper = buildDiscountTerms({
      ...INPUT,
      company_id: 'COMPANY-1',
      business_id: 'BUSINESS-1',
      branch_id: 'BRANCH-1',
      customer_id: 'CUSTOMER-1',
      session_id: 'SESSION-1',
      service_id: 'SERVICE-1',
      requested_by: 'USER-1',
      requested_by_membership_id: 'MEMBERSHIP-1',
      performer_ids: ['EMPLOYEE-2', 'EMPLOYEE-1'],
    });
    expect(canonicalDiscountTerms(upper)).toBe(canonicalDiscountTerms(TERMS));
  });
});

describe('the fingerprint of the terms', () => {
  it('gives the same hash to the same terms', () => {
    expect(discountTermsHash(TERMS, fakeSha256)).toBe(
      discountTermsHash(buildDiscountTerms(INPUT), fakeSha256),
    );
  });

  it('gives the same hash to performers given in another order', () => {
    const reordered = buildDiscountTerms({ ...INPUT, performer_ids: ['employee-1', 'employee-2'] });
    expect(discountTermsHash(reordered, fakeSha256)).toBe(discountTermsHash(TERMS, fakeSha256));
  });

  it.each(CHANGED_FIELDS)('changes the canonical text when %s changes', (field, value) => {
    const changed = { ...TERMS, [field]: value } as unknown as DiscountTermsV1;
    expect(canonicalDiscountTerms(changed)).not.toBe(canonicalDiscountTerms(TERMS));
  });

  it('gives a different hash to different terms', () => {
    const changed = { ...TERMS, discount: '5.500' } as unknown as DiscountTermsV1;
    expect(discountTermsHash(changed, fakeSha256)).not.toBe(discountTermsHash(TERMS, fakeSha256));
  });
});
