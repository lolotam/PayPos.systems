import { describe, expect, it } from 'vitest';

import { packageRefundResponse, refundPackageInput } from './package-refund.js';

const id = '00000000-0000-7000-8000-000000000001';
const input = {
  component_id: id,
  sessions: 3,
  method: 'CASH',
  reason: 'Customer asked for a refund',
};

describe('refundPackageInput', () => {
  it('accepts exactly the refund command fields', () => {
    expect(refundPackageInput.parse(input)).toEqual(input);
  });

  it('rejects any additional field', () => {
    expect(refundPackageInput.safeParse({ ...input, amount: '10.000' }).success).toBe(false);
    expect(refundPackageInput.safeParse({ ...input, branch_id: id }).success).toBe(false);
  });

  it.each([0, -1, 1.5])('rejects a session count of %s', (sessions) => {
    expect(refundPackageInput.safeParse({ ...input, sessions }).success).toBe(false);
  });

  it('accepts CASH and CARD and refuses any other method', () => {
    expect(refundPackageInput.safeParse({ ...input, method: 'CASH' }).success).toBe(true);
    expect(refundPackageInput.safeParse({ ...input, method: 'CARD' }).success).toBe(true);
    expect(refundPackageInput.safeParse({ ...input, method: 'TRANSFER' }).success).toBe(false);
    expect(refundPackageInput.safeParse({ ...input, method: 'cash' }).success).toBe(false);
  });

  it('requires a reason and a component', () => {
    expect(refundPackageInput.safeParse({ ...input, reason: undefined }).success).toBe(false);
    expect(refundPackageInput.safeParse({ ...input, component_id: undefined }).success).toBe(false);
  });
});

describe('packageRefundResponse', () => {
  const response = {
    id,
    entitlement_id: id,
    component_id: id,
    sessions: 3,
    amount: '11.250',
    method: 'CASH',
    refunded_amount: '11.250',
    revision: 2,
    refunded_at: '2026-10-15T08:00:00.000Z',
  };

  it('models the stored refund facts with three-decimal money', () => {
    expect(packageRefundResponse.parse(response)).toEqual(response);
    expect(packageRefundResponse.safeParse({ ...response, amount: '11.25' }).success).toBe(false);
    expect(packageRefundResponse.safeParse({ ...response, sessions: 0 }).success).toBe(false);
    expect(packageRefundResponse.safeParse({ ...response, refunded_at: 'not-a-date' }).success).toBe(
      false,
    );
  });

  it('never carries the reason', () => {
    expect(packageRefundResponse.parse({ ...response, reason: 'Customer asked' })).not.toHaveProperty(
      'reason',
    );
  });
});
