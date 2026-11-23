import { describe, expect, it } from 'vitest';

import { computeStatementPayable, type PayableRow } from '../statement-payable.ts';

const row = (kind: PayableRow['kind'], amount: string): PayableRow => ({ kind, amount });

describe('the statement payable (§9, CS-Q7, CS-Q29, BR-06)', () => {
  it('pays only the tips when the commission side is negative, and carries the whole negative commission', () => {
    const result = computeStatementPayable([
      row('COMMISSION', '-25.000'),
      row('TIP_CARD', '6.000'),
    ]);
    expect(result).toEqual({
      commissionSubtotal: -25_000n,
      tipSide: 6_000n,
      payable: 6_000n,
      commissionCarryOut: -25_000n,
      tipCarryOut: 0n,
    });
  });

  it('pays zero and carries the negative tip side when a card-tip correction exceeds the tips', () => {
    const result = computeStatementPayable([
      row('TIP_CARD', '2.000'),
      row('CORRECTION_TIP_CARD', '-10.000'),
    ]);
    expect(result).toMatchObject({
      payable: 0n,
      tipSide: -8_000n,
      tipCarryOut: -8_000n,
      commissionCarryOut: 0n,
    });
  });

  it('never nets the two sides: a negative commission does not reduce the tips and the reverse', () => {
    const both = computeStatementPayable([row('COMMISSION', '-5.000'), row('TIP_CARD', '-2.000')]);
    expect(both).toMatchObject({ payable: 0n, commissionCarryOut: -5_000n, tipCarryOut: -2_000n });
    const positive = computeStatementPayable([
      row('COMMISSION', '10.000'),
      row('TIP_CARD', '3.000'),
    ]);
    expect(positive).toMatchObject({ payable: 13_000n, commissionCarryOut: 0n, tipCarryOut: 0n });
  });
});

describe('what the statement payable adds and what it only shows', () => {
  it('sums commission, sale, correction and incoming carries on the commission side', () => {
    const result = computeStatementPayable([
      row('COMMISSION', '15.000'),
      row('SALE', '4.000'),
      row('CORRECTION', '3.000'),
      row('CARRY_COMMISSION', '-5.000'),
    ]);
    expect(result.commissionSubtotal).toBe(17_000n);
    expect(result.payable).toBe(17_000n);
  });

  it('shows cash tips and the EMPLOYEE row without adding them (D-36)', () => {
    const result = computeStatementPayable([
      row('TIP_CASH', '9.000'),
      row('CORRECTION_TIP_CASH', '-1.000'),
      row('EMPLOYEE', '0.000'),
    ]);
    expect(result).toEqual({
      commissionSubtotal: 0n,
      tipSide: 0n,
      payable: 0n,
      commissionCarryOut: 0n,
      tipCarryOut: 0n,
    });
  });

  it('pays a zero balance as zero and carries nothing', () => {
    const result = computeStatementPayable([
      row('COMMISSION', '5.000'),
      row('CORRECTION', '-5.000'),
    ]);
    expect(result).toMatchObject({ payable: 0n, commissionCarryOut: 0n });
  });
});
