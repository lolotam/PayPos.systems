import { expect, it } from 'vitest';
import { ratingAverageItem, ratingAverages, ratingAveragesQuery } from './ratings-averages.js';

const uuid = '018f0000-0000-7000-8000-000000000001';
const item = { employee_id: uuid, name_ar: null, name_en: 'Sara', average: '4.5', count: 2 };

it('accepts every filter and none of them', () => {
  expect(ratingAveragesQuery.parse({})).toEqual({});
  expect(
    ratingAveragesQuery.parse({
      branch_id: uuid,
      employee_id: uuid,
      from: '2026-06-01T00:00:00Z',
      to: '2026-07-01T00:00:00Z',
    }).employee_id,
  ).toBe(uuid);
});

it.each([
  { business_id: uuid },
  { limit: '20' },
  { cursor: 'abc' },
  { branch_id: 'x' },
  { from: '2026-07-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
  { from: '2026-06-01', to: '2026-07-01T00:00:00Z' },
])('refuses the query %j', (query) => {
  expect(ratingAveragesQuery.safeParse(query).success).toBe(false);
});

it('keeps the average a one-decimal string from 1.0 to 5.0 with a positive count', () => {
  expect(ratingAverages.parse({ items: [item] }).items).toHaveLength(1);
  expect(ratingAverages.parse({ items: [] }).items).toEqual([]);
  for (const bad of [{ average: 4.5 }, { average: '4.55' }, { average: '5.1' }, { average: '0.9' }])
    expect(ratingAverageItem.safeParse({ ...item, ...bad }).success).toBe(false);
  expect(ratingAverageItem.safeParse({ ...item, count: 0 }).success).toBe(false);
});

it('refuses an entry without her English name or without the employee', () => {
  expect(ratingAverageItem.safeParse({ ...item, name_en: undefined }).success).toBe(false);
  expect(ratingAverageItem.safeParse({ ...item, employee_id: undefined }).success).toBe(false);
});

it('carries the resolved month as YYYY-MM or null, and stays valid without it for an older server', () => {
  expect(ratingAverages.parse({ items: [], month: '2026-06' }).month).toBe('2026-06');
  expect(ratingAverages.parse({ items: [], month: null }).month).toBeNull();
  expect(ratingAverages.parse({ items: [] }).month).toBeUndefined();
  expect(ratingAverages.safeParse({ items: [], month: '2026-13' }).success).toBe(false);
});
