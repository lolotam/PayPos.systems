import { expect, it } from 'vitest';
import { ratingAveragesQuery } from './ratings-averages.js';
import {
  isPeriodForward,
  monthExcludesRange,
  periodIsValid,
  PERIOD_FRACTION_DIGITS,
} from './ratings-period.js';
import { ratingsListQuery } from './ratings-list.js';

const base = '2026-06-15T12:00:00';
const uuid = '018f0000-0000-7000-8000-000000000001';

it.each([
  [`${base}.123001Z`, `${base}.123999Z`],
  [`${base}.000001Z`, `${base}.000002Z`],
  [`${base}.5Z`, `${base}.500001Z`],
  [`${base}.123456Z`, `${base}.123457Z`],
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

it.each([
  `${base}.1234561Z`,
  `${base}.1234567Z`,
  `${base}.12345600Z`,
  '2026-06-15T15:00:00.1234561+03:00',
])('refuses more than six fractional digits on either bound: %s', (long) => {
  expect(PERIOD_FRACTION_DIGITS).toBe(6);
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    expect(schema.safeParse({ from: long }).success).toBe(false);
    expect(schema.safeParse({ to: long }).success).toBe(false);
    expect(schema.safeParse({ from: `${base}.123456Z`, to: long }).success).toBe(false);
    expect(schema.safeParse({ from: long, to: `${base}.123457Z` }).success).toBe(false);
  }
});

it('names the bound whose fraction is too long, not the order of the range', () => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    const longFrom = schema.safeParse({ from: `${base}.1234561Z`, to: `${base}.9Z` });
    expect(longFrom.success ? [] : longFrom.error.issues.map((i) => [i.path, i.message])).toEqual([
      [['from'], 'fractional seconds must have at most 6 digits (microsecond precision)'],
    ]);
    const longTo = schema.safeParse({ from: `${base}.1Z`, to: `${base}.1234561Z` });
    expect(longTo.success ? [] : longTo.error.issues.map((i) => i.path)).toEqual([['to']]);
  }
});

it('still accepts exactly six digits and a whole-second or short fraction', () => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    expect(schema.safeParse({ from: `${base}.123456Z`, to: `${base}.123457Z` }).success).toBe(true);
    expect(schema.safeParse({ from: `${base}Z`, to: `${base}.1Z` }).success).toBe(true);
  }
});

it.each([
  '0000-01-01T00:00:00Z',
  '0000-12-31T23:59:59.5Z',
  '2026-06-15T12:00:00+16:00',
  '2026-06-15T12:00:00-16:00',
  '2026-06-15T12:00:00+23:59',
])('refuses an instant PostgreSQL rejects, on a one-sided range too: %s', (bad) => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    expect(schema.safeParse({ from: bad }).success).toBe(false);
    expect(schema.safeParse({ to: bad }).success).toBe(false);
    const both = schema.safeParse({ from: bad, to: '2026-07-01T00:00:00Z' });
    expect(both.success ? [] : both.error.issues.map((i) => i.path)).toEqual([['from']]);
  }
});

it.each(['0001-01-01T00:00:00Z', '2026-06-15T12:00:00+15:59', '2026-06-15T12:00:00-15:59'])(
  'still accepts an instant at the edge of what PostgreSQL accepts: %s',
  (edge) => {
    for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
      expect(schema.safeParse({ from: edge }).success).toBe(true);
      expect(schema.safeParse({ to: edge }).success).toBe(true);
    }
  },
);

it.each(['2026-11', '2000-01', '2999-12'])('accepts the month %s on both routes', (month) => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery])
    expect(schema.parse({ month }).month).toBe(month);
});

it.each([
  '2026-13',
  '2026-00',
  '2026-1',
  '2026-11-01',
  '2026-11 ',
  ' 2026-11',
  '1999-12',
  '3000-01',
  '0000-01',
  'abc',
  '',
])('refuses the malformed month %j on both routes', (month) => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery])
    expect(schema.safeParse({ month }).success).toBe(false);
});

it.each([
  { from: `${base}Z` },
  { to: `${base}Z` },
  { from: `${base}Z`, to: '2026-07-01T00:00:00Z' },
])('refuses month combined with %j and names month', (range) => {
  for (const schema of [ratingsListQuery, ratingAveragesQuery]) {
    const refused = schema.safeParse({ month: '2026-06', ...range });
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path)).toEqual([['month']]);
  }
});

it('lets the month ride with the other filters and the cursor', () => {
  expect(
    ratingsListQuery.safeParse({
      month: '2026-06',
      branch_id: uuid,
      employee_id: uuid,
      cursor: 'x',
    }).success,
  ).toBe(true);
  expect(monthExcludesRange({})).toBe(true);
  expect(monthExcludesRange({ month: '2026-06' })).toBe(true);
  expect(monthExcludesRange({ month: '2026-06', to: `${base}Z` })).toBe(false);
});
