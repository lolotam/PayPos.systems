import { expect, it } from 'vitest';
import { offeredStaffColumns } from './offered-staff-columns';

it('offers the ten contract columns in enum order, without the postponed rating average', () => {
  expect(offeredStaffColumns()).toEqual([
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
});
