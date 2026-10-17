import { expect, it } from 'vitest';
import { serviceLineEditItem, serviceLineEditsPage, serviceLineEditsQuery } from './service-session-edits.js';

it('caps history pages at 200 and rejects a cursor outside the opaque alphabet', () => {
  expect(serviceLineEditsQuery.parse({})).toEqual({ limit: 50 });
  expect(serviceLineEditsQuery.parse({ limit: '200' }).limit).toBe(200);
  for (const bad of [{ limit: 0 }, { limit: 201 }, { cursor: '*' }, { cursor: '' }, { employee_id: 'client' }]) {
    expect(serviceLineEditsQuery.safeParse(bad).success).toBe(false);
  }
});

it('keeps a history page strict and accepts microsecond money rows', () => {
  expect(serviceLineEditsPage.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  expect(serviceLineEditsPage.safeParse({ items: [], next_cursor: null, reason: 'hidden' }).success).toBe(false);
  const money = { price: '25.000', discount: '1.000', net: '24.000' };
  const item = { revision: 2, previous: money, new: { price: '22.000', discount: '2.000', net: '20.000' },
    changed_at: '2026-10-14T08:00:06.000000Z', editor_label_ar: 'Layla', editor_label_en: 'Layla', reason: 'Corrected the price' };
  expect(serviceLineEditItem.parse(item)).toEqual(item);
});

it('parses a reason of 500 four-byte characters', () => {
  const reason = '😀'.repeat(500);
  const money = { price: '25.000', discount: '0.000', net: '25.000' };
  const item = { revision: 2, previous: money, new: money, changed_at: '2026-10-14T08:00:06.000000Z',
    editor_label_ar: 'Layla', editor_label_en: 'Layla', reason };
  expect(serviceLineEditItem.parse(item).reason).toBe(reason);
});
