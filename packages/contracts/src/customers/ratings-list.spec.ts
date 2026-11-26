import { expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi.js';
import { ratingsListPaths } from './ratings-list-openapi.js';
import {
  ratingsCursorKey,
  ratingsListItem,
  ratingsListPage,
  ratingsListQuery,
} from './ratings-list.js';

const uuid = '018f0000-0000-7000-8000-000000000001';
const item = {
  id: uuid,
  stars: 2,
  submitted_at: '2026-06-15T12:00:00.123456Z',
  business_date: '2026-06-15',
  branch: { id: uuid, name_ar: null, name_en: 'Salmiya' },
  performers: [{ employee_id: uuid, name_ar: 'سارة', name_en: 'Sara' }],
  comment: 'Rated 2 <b>as written</b> 0501234567',
};

it('defaults the limit and accepts every filter', () => {
  expect(ratingsListQuery.parse({}).limit).toBe(20);
  const parsed = ratingsListQuery.parse({
    branch_id: uuid,
    employee_id: uuid,
    from: '2026-06-01T00:00:00Z',
    to: '2026-07-01T00:00:00Z',
    cursor: 'abc',
    limit: '50',
  });
  expect(parsed.limit).toBe(50);
});

it.each([
  { business_id: uuid },
  { company_id: uuid },
  { limit: '0' },
  { limit: '101' },
  { branch_id: 'x' },
  { from: '2026-07-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
  { from: '2026-06-01', to: '2026-07-01T00:00:00Z' },
])('refuses the query %j', (query) => {
  expect(ratingsListQuery.safeParse(query).success).toBe(false);
});

it('returns the comment as written, or null, and the page cursor', () => {
  expect(ratingsListItem.parse(item).comment).toBe(item.comment);
  expect(ratingsListItem.parse({ ...item, comment: null }).comment).toBeNull();
  expect(ratingsListPage.parse({ items: [item], next_cursor: null }).items).toHaveLength(1);
});

it('refuses a performer without her English name', () => {
  const nameless = [{ employee_id: uuid, name_ar: null }];
  expect(ratingsListItem.safeParse({ ...item, performers: nameless }).success).toBe(false);
});

it('refuses a star count outside 1 to 5 and a missing performers list', () => {
  expect(ratingsListItem.safeParse({ ...item, stars: 6 }).success).toBe(false);
  expect(ratingsListItem.safeParse({ ...item, performers: undefined }).success).toBe(false);
});

it('accepts a cursor position only with an instant PostgreSQL takes, the same rule as the period bounds', () => {
  expect(ratingsCursorKey.safeParse({ at: '2026-06-15T12:00:00.123456Z', id: uuid }).success).toBe(
    true,
  );
  for (const at of [
    '0000-06-15T12:00:00Z',
    '2026-06-15T12:00:00+16:00',
    '2026-06-15T12:00:00.1234567Z',
    '2026-06-15T12:00:00',
  ])
    expect(ratingsCursorKey.safeParse({ at, id: uuid }).success, at).toBe(false);
});

it('carries the resolved month as YYYY-MM or null, and stays valid without it for an older server', () => {
  const base = { items: [item], next_cursor: null };
  expect(ratingsListPage.parse({ ...base, month: '2026-06' }).month).toBe('2026-06');
  expect(ratingsListPage.parse({ ...base, month: null }).month).toBeNull();
  expect(ratingsListPage.parse(base).month).toBeUndefined();
  expect(ratingsListPage.safeParse({ ...base, month: '2026-6' }).success).toBe(false);
});

it('requires the admin session cookie on the ratings list, in the exported and the generated operation', () => {
  const path = '/v1/businesses/{businessId}/ratings';
  expect(ratingsListPaths[path].get.security).toEqual([{ AdminSession: [] }]);
  const paths = buildOpenApiDocument()['paths'] as Record<
    string,
    { get?: { security?: unknown } }
  >;
  expect(paths[path]?.get?.security).toEqual([{ AdminSession: [] }]);
});
