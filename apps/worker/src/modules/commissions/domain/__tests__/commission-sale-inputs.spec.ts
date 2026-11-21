import { describe, expect, it } from 'vitest';

import {
  assertSaleIdentityUnchanged,
  reduceCommissionSale,
  saleAffectedPeriods,
  type CommissionSaleInputEvent,
} from '../commission-sale-inputs.ts';
import { CommissionSaleInputInvalidError } from '../errors.ts';

const SALE_ID = '01970000-0000-7000-8000-000000000001';

const saleEvent = (overrides: Partial<CommissionSaleInputEvent> = {}): CommissionSaleInputEvent => ({
  businessId: '01920000-0000-7000-8000-0000000000b1',
  branchId: '01920000-0000-7000-8000-0000000000c1',
  saleId: SALE_ID,
  sellerEmployeeId: '01920000-0000-7000-8000-0000000000e1',
  businessDate: '2026-11-01',
  pricePaid: '30.000',
  refundedAmount: '0.000',
  status: 'SOLD',
  revision: 1,
  ...overrides,
});

describe('reduceCommissionSale', () => {
  it('applies revision 1 to an empty projection with the period from the business date', () => {
    const outcome = reduceCommissionSale(null, saleEvent());
    expect(outcome.applied).toBe(true);
    expect(outcome.row).toMatchObject({
      businessId: '01920000-0000-7000-8000-0000000000b1',
      saleId: SALE_ID,
      branchId: '01920000-0000-7000-8000-0000000000c1',
      sellerEmployeeId: '01920000-0000-7000-8000-0000000000e1',
      businessDate: '2026-11-01', period: '2026-11',
      pricePaid: 30000n, refundedAmount: 0n,
      status: 'SOLD', revision: 1,
    });
  });

  it('replaces the row when a newer revision arrives and keeps paid, seller, branch and date', () => {
    const held = reduceCommissionSale(null, saleEvent()).row;
    const outcome = reduceCommissionSale(held, saleEvent({ revision: 2, refundedAmount: '10.000' }));
    expect(outcome.applied).toBe(true);
    expect(outcome.row).toMatchObject({
      pricePaid: 30000n, refundedAmount: 10000n, revision: 2,
      sellerEmployeeId: '01920000-0000-7000-8000-0000000000e1',
      branchId: '01920000-0000-7000-8000-0000000000c1',
      businessDate: '2026-11-01',
    });
  });

  it.each([
    { label: 'equal', heldRevision: 2, eventRevision: 2 },
    { label: 'older', heldRevision: 2, eventRevision: 1 },
  ])('ignores an $label revision as a no-op', ({ heldRevision, eventRevision }) => {
    const held = reduceCommissionSale(null, saleEvent({ revision: heldRevision })).row;
    const outcome = reduceCommissionSale(held, saleEvent({ revision: eventRevision }));
    expect(outcome).toEqual({ applied: false, row: null });
  });
});

describe('reduceCommissionSale: refuse a producer bug', () => {
  it.each([
    { pricePaid: 'abc', refundedAmount: '0.000', reason: 'MALFORMED_PRICE_PAID' },
    { pricePaid: '30.000', refundedAmount: 'x.y', reason: 'MALFORMED_REFUNDED_AMOUNT' },
    { pricePaid: '-1.000', refundedAmount: '0.000', reason: 'MALFORMED_PRICE_PAID' },
  ])(
    'refuses the malformed amount $pricePaid/$refundedAmount with $reason and never projects zero',
    ({ pricePaid, refundedAmount, reason }) => {
      expect(() =>
        reduceCommissionSale(null, saleEvent({ pricePaid, refundedAmount })),
      ).toThrow(expect.objectContaining({ code: 'COMMISSION_SALE_INPUT_INVALID', reason }));
    },
  );

  it('refuses a refund above the price as a producer bug (FR-017)', () => {
    const work = () =>
      reduceCommissionSale(null, saleEvent({ refundedAmount: '30.001' }));
    expect(work).toThrow(CommissionSaleInputInvalidError);
    expect(work).toThrow(
      expect.objectContaining({ reason: 'REFUND_ABOVE_PRICE' }),
    );
  });

  it('accepts a full refund exactly at the price', () => {
    const outcome = reduceCommissionSale(null, saleEvent({ refundedAmount: '30.000' }));
    expect(outcome.applied).toBe(true);
    expect(outcome.row?.refundedAmount).toBe(30000n);
  });

  it('bounds the sale business date to supported calendar years', () => {
    expect(reduceCommissionSale(null, saleEvent({ businessDate: '0001-01-01' })).row?.period)
      .toBe('0001-01');
    expect(() => reduceCommissionSale(null, saleEvent({ businessDate: '0000-01-01' }))).toThrow(
      expect.objectContaining({ code: 'COMMISSION_SALE_INPUT_INVALID', reason: 'BUSINESS_DATE_OUT_OF_RANGE' }),
    );
  });

  it('accepts the highest integer revision the commission_sales column holds', () => {
    const outcome = reduceCommissionSale(null, saleEvent({ revision: 2147483647 }));
    expect(outcome.applied).toBe(true);
    expect(outcome.row?.revision).toBe(2147483647);
  });

  it('refuses a revision above the integer range at the typed continuable path, held revision aside', () => {
    const work = () => reduceCommissionSale(null, saleEvent({ revision: 2147483648 }));
    expect(work).toThrow(CommissionSaleInputInvalidError);
    expect(work).toThrow(expect.objectContaining({ reason: 'REVISION_OUT_OF_RANGE' }));
    // مراجعة قديمة فوق المدى خطأ منتج كذلك، فالرفض قبل حارس المراجعة لا بعده.
    const staleWork = () =>
      reduceCommissionSale(reduceCommissionSale(null, saleEvent()).row, saleEvent({ revision: 3000000000 }));
    expect(staleWork).toThrow(expect.objectContaining({ reason: 'REVISION_OUT_OF_RANGE' }));
  });
});

describe('saleAffectedPeriods', () => {
  it('returns the new month alone when no row is held', () => {
    expect(saleAffectedPeriods(null, '2026-11-01')).toEqual(['2026-11']);
  });

  it('unions the held month with the new month sorted ascending when a refund moves the sale', () => {
    expect(saleAffectedPeriods('2026-10', '2026-11-20')).toEqual(['2026-10', '2026-11']);
  });

  it('returns one month when the held month equals the new one', () => {
    expect(saleAffectedPeriods('2026-11', '2026-11-05')).toEqual(['2026-11']);
  });
});

describe('assertSaleIdentityUnchanged', () => {
  it('accepts a first revision with no held row', () => {
    expect(() => assertSaleIdentityUnchanged(null, saleEvent())).not.toThrow();
  });

  it('accepts a newer revision for the same business', () => {
    const held = reduceCommissionSale(null, saleEvent()).row;
    expect(() =>
      assertSaleIdentityUnchanged(held, saleEvent({ revision: 2 })),
    ).not.toThrow();
  });

  it('refuses a later revision that names another business and never moves the row', () => {
    const held = reduceCommissionSale(null, saleEvent()).row;
    const work = () =>
      assertSaleIdentityUnchanged(
        held,
        saleEvent({ businessId: '01920000-0000-7000-8000-0000000000b2' }),
      );
    expect(work).toThrow(CommissionSaleInputInvalidError);
    expect(work).toThrow(expect.objectContaining({ reason: 'SALE_BUSINESS_CHANGED' }));
  });

  it('compares business ids without case sensitivity', () => {
    const held = reduceCommissionSale(null, saleEvent()).row;
    expect(() =>
      assertSaleIdentityUnchanged(
        held,
        saleEvent({ businessId: saleEvent().businessId.toUpperCase() }),
      ),
    ).not.toThrow();
  });
});
