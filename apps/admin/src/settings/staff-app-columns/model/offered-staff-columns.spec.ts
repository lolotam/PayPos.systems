import { staffColumnCode } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { offeredStaffColumns } from './offered-staff-columns';

it('offers every contract column except the postponed rating average', () => {
  const offered = offeredStaffColumns();
  expect(offered).toEqual([
    'date',
    'time',
    'service',
    'customer_name',
    'list_price',
    'discount',
    'net',
    'share',
    'estimated_commission',
    'tip',
  ]);
  expect(offered).toHaveLength(10);
  expect(offered).not.toContain('rating_average');
});

it('keeps the order of the contract enum', () => {
  const expected = staffColumnCode.options.filter((code) => code !== 'rating_average');
  expect(offeredStaffColumns()).toEqual(expected);
});
