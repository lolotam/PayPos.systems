import { expect, it } from 'vitest';
import {
  serviceLinePerformerChangeItem,
  serviceLinePerformerChangesPage,
  serviceLinePerformerChangesQuery,
} from './service-session-performer-changes.js';

it('caps history pages at 200 and rejects a cursor outside the opaque alphabet', () => {
  expect(serviceLinePerformerChangesQuery.parse({})).toEqual({ limit: 50 });
  expect(serviceLinePerformerChangesQuery.parse({ limit: '200' }).limit).toBe(200);
  for (const bad of [{ limit: 0 }, { limit: 201 }, { cursor: '*' }, { cursor: '' }, { employee_id: 'client' }]) {
    expect(serviceLinePerformerChangesQuery.safeParse(bad).success).toBe(false);
  }
});

it('drops an unknown key on a history page and accepts a change with both sides', () => {
  expect(serviceLinePerformerChangesPage.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  expect(serviceLinePerformerChangesPage.parse({ items: [], next_cursor: null, reason: 'hidden' })).toEqual({
    items: [],
    next_cursor: null,
  });
  const item = {
    revision: 2, changed_at: '2026-10-14T08:00:06.000000Z', changer_label_ar: 'ليلى', changer_label_en: 'Layla',
    reason: 'Split the work between two performers',
    before: [{ name_ar: null, name_en: 'Sara', share_bps: 10000 }],
    after: [{ name_ar: 'سارة', name_en: 'Sara', share_bps: 7000 }, { name_ar: null, name_en: 'Rana', share_bps: 3000 }],
  };
  expect(serviceLinePerformerChangeItem.parse(item)).toEqual(item);
});

it('refuses an empty side, a fifth performer and a share outside 1..10000', () => {
  const one = { name_ar: null, name_en: 'Sara', share_bps: 10000 };
  const item = {
    revision: 2, changed_at: '2026-10-14T08:00:06.000000Z', changer_label_ar: 'ليلى', changer_label_en: 'Layla',
    reason: 'Changed the performers', before: [one], after: [one],
  };
  expect(serviceLinePerformerChangeItem.safeParse({ ...item, before: [] }).success).toBe(false);
  expect(serviceLinePerformerChangeItem.safeParse({ ...item, after: [] }).success).toBe(false);
  expect(serviceLinePerformerChangeItem.safeParse({ ...item, after: [one, one, one, one, one] }).success).toBe(false);
  expect(serviceLinePerformerChangeItem.safeParse({ ...item, after: [{ ...one, share_bps: 0 }] }).success).toBe(false);
  expect(serviceLinePerformerChangeItem.safeParse({ ...item, after: [{ ...one, share_bps: 10001 }] }).success).toBe(false);
});
