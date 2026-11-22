import { expect, it } from 'vitest';
import { ratingAveragesQuery } from './ratings-averages.js';
import { isPeriodForward, periodIsValid } from './ratings-period.js';
import { ratingsListQuery } from './ratings-list.js';

const base = '2026-06-15T12:00:00';

it.each([
  [`${base}.123001Z`, `${base}.123999Z`],
  [`${base}.000001Z`, `${base}.000002Z`],
  [`${base}.5Z`, `${base}.500001Z`],
  [`${base}.123456Z`, `${base}.1234561Z`],
  [`${base}Z`, `${base}.000001Z`],
  ['2026-06-15T15:00:00.5+03:00', `${base}.500001Z`],
  [`${base}.999999Z`, '2026-06-15T12:00:01Z'],
  [`${base}Z`, '2026-06-15T12:00:01Z'],
])('accepts the increasing range %s -> %s, even inside one millisecond', (from, to) => {
  expect(isPeriodForward(from, to)).toBe(true);
  expect(ratingsListQuery.safeParse({ from, to }).success).toBe(true);
  expect(ratingAveragesQuery.safeParse({ from, to }).success).toBe(true);
});

it.each([
  [`${base}.123001Z`, `${base}.123001Z`],
  [`${base}.123999Z`, `${base}.123001Z`],
  [`${base}.5Z`, `${base}.500000Z`],
  [`${base}Z`, `${base}.000000Z`],
  ['2026-06-15T15:00:00.5+03:00', `${base}.500000Z`],
  [`${base}.000002Z`, `${base}.000001Z`],
  ['2026-06-15T12:00:01Z', `${base}.999999Z`],
])('refuses the equal or decreasing range %s -> %s', (from, to) => {
  expect(isPeriodForward(from, to)).toBe(false);
  expect(ratingsListQuery.safeParse({ from, to }).success).toBe(false);
  expect(ratingAveragesQuery.safeParse({ from, to }).success).toBe(false);
});

it('leaves a half-open or absent period valid and keeps the error on from', () => {
  expect(periodIsValid({})).toBe(true);
  expect(periodIsValid({ from: `${base}Z` })).toBe(true);
  expect(periodIsValid({ to: `${base}Z` })).toBe(true);
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    const refused = schema.safeParse({ from: `${base}.2Z`, to: `${base}.1Z` });
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path)).toEqual([['from']]);
  }
});
