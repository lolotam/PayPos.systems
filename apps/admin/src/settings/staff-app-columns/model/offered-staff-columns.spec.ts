import { expect, it } from 'vitest';
import { offeredStaffColumns } from './offered-staff-columns';

it('offers every contract column in enum order, the rating average last (D-A7)', () => {
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
    'rating_average',
  ]);
});
