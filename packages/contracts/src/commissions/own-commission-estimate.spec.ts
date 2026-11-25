import { expect, it } from 'vitest';
import {
  ownCommissionCorrection,
  ownCommissionEstimate,
  ownCommissionEstimateQuery,
} from './own-commission-estimate.js';

const lineCorrection = {
  kind: 'LINE',
  source_period: '2026-10',
  business_date: '2026-10-14',
  service_name_ar: 'خدمة',
  service_name_en: 'Service',
  previous_amount: '1.000',
  new_amount: '2.000',
  amount: '1.000',
};

it('accepts the estimate of the open month with its total and its own lines', () => {
  expect(
    ownCommissionEstimate.parse({
      status: 'ESTIMATE',
      total: '12.500',
      per_line: [{ line_id: '01920000-0000-7000-8000-00000000d501', amount: '12.500' }],
      corrections: [],
      recalculated: false,
    }),
  ).toMatchObject({ status: 'ESTIMATE', total: '12.500', recalculated: false });
});

it('hidden carries no figure and no extra key', () => {
  expect(ownCommissionEstimate.parse({ status: 'HIDDEN' })).toEqual({ status: 'HIDDEN' });
  expect(ownCommissionEstimate.safeParse({ status: 'HIDDEN', total: '1.000' }).success).toBe(false);
});

it('a pricing failure keeps the corrections and drops the figure', () => {
  for (const status of ['NO_PLAN', 'NO_SALARY'] as const) {
    const parsed = ownCommissionEstimate.parse({ status, corrections: [] });
    expect(parsed).toEqual({ status, corrections: [] });
    expect(parsed).not.toHaveProperty('total');
    expect(parsed).not.toHaveProperty('per_line');
  }
});

it('the approved month carries the approved total and the corrections only', () => {
  expect(
    ownCommissionEstimate.parse({ status: 'APPROVED', total: '4.000', corrections: [] }),
  ).toEqual({ status: 'APPROVED', total: '4.000', corrections: [] });
  expect(
    ownCommissionEstimate.safeParse({
      status: 'APPROVED',
      total: '4.000',
      corrections: [],
      per_line: [],
    }).success,
  ).toBe(false);
});

it('a correction of a line carries its service and a correction of a sale or a tip carries none', () => {
  expect(ownCommissionCorrection.parse(lineCorrection)).toMatchObject({ kind: 'LINE' });
  for (const kind of ['SALE', 'TIP_CARD', 'TIP_CASH'] as const) {
    expect(
      ownCommissionCorrection.safeParse({
        ...lineCorrection,
        kind,
        service_name_ar: null,
        service_name_en: null,
      }).success,
    ).toBe(true);
    expect(ownCommissionCorrection.safeParse({ ...lineCorrection, kind }).success).toBe(false);
  }
});

it('a correction never carries a customer field', () => {
  expect(ownCommissionCorrection.safeParse({ ...lineCorrection, customer_name: 'Ahmad' }).success).toBe(
    false,
  );
  expect(
    ownCommissionCorrection.safeParse({ ...lineCorrection, customer_phone: '+96550000000' }).success,
  ).toBe(false);
});

it('the query accepts the month alone and refuses any other key', () => {
  expect(ownCommissionEstimateQuery.parse({})).toEqual({});
  expect(ownCommissionEstimateQuery.parse({ month: '2026-10' })).toEqual({ month: '2026-10' });
  expect(ownCommissionEstimateQuery.safeParse({ month: 'bad' }).success).toBe(false);
  expect(ownCommissionEstimateQuery.safeParse({ employee_id: 'foreign' }).success).toBe(false);
});

it('the correction amounts keep the canonical KWD shape', () => {
  expect(
    ownCommissionCorrection.safeParse({ ...lineCorrection, amount: '1.00' }).success,
  ).toBe(false);
  expect(
    ownCommissionCorrection.safeParse({ ...lineCorrection, previous_amount: '-2.500' }).success,
  ).toBe(true);
});
