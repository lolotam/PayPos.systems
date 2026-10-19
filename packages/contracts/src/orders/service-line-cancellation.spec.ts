import { expect, it } from 'vitest';
import { serviceLineCancellation } from './service-line-cancellation.js';

const money = { price: '25.000', discount: '1.000', net: '24.000' };
const row = {
  cancelled_at: '2026-10-14T08:00:06.000000Z',
  canceller_label_ar: 'ليلى',
  canceller_label_en: 'Layla',
  reason: 'Corrected the visit',
  previous: { revision: 1, ...money },
};

it('drops an unknown key and keeps the cancellation the screen is allowed to see', () => {
  expect(serviceLineCancellation.parse({ ...row, cancelled_by: 'hidden' })).toEqual(row);
  expect(serviceLineCancellation.parse(row)).toEqual(row);
});

it('accepts a reason of 500 four-byte characters and rejects an empty label', () => {
  const reason = '😀'.repeat(500);
  expect(serviceLineCancellation.parse({ ...row, reason }).reason).toBe(reason);
  expect(serviceLineCancellation.safeParse({ ...row, canceller_label_en: '' }).success).toBe(false);
  expect(
    serviceLineCancellation.safeParse({ ...row, previous: { ...row.previous, revision: 0 } })
      .success,
  ).toBe(false);
});
