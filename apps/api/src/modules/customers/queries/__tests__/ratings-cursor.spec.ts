import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../shared/errors.ts';
import { decodeRatingsCursor, encodeRatingsCursor } from '../ratings-cursor.ts';

const ID = '01920000-0000-7000-8000-0000000000AB';
const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const codeOf = (cursor: string) => {
  try {
    decodeRatingsCursor(cursor);
    return 'accepted';
  } catch (error) {
    return error instanceof ApiError ? error.code : 'other';
  }
};

describe('ratings cursor', () => {
  it('round-trips the position of the last row with microseconds and lowercases the id', () => {
    const at = '2026-06-10T09:30:15.123456Z';
    expect(decodeRatingsCursor(encodeRatingsCursor(at, ID))).toEqual({
      at,
      id: ID.toLowerCase(),
    });
    expect(decodeRatingsCursor(undefined)).toBeNull();
  });

  it.each([
    ['year zero', '0000-06-10T09:30:15.123456Z'],
    ['an offset beyond 15:59', '2026-06-10T09:30:15+16:00'],
    ['a seventh fractional digit', '2026-06-10T09:30:15.1234567Z'],
    ['an impossible date', '2026-02-30T09:30:15Z'],
    ['no offset', '2026-06-10T09:30:15'],
  ])(
    'refuses a cursor timestamp with %s with the uniform 400 instead of a database cast error',
    (_name, at) => {
      expect(codeOf(raw({ at, id: ID }))).toBe('BAD_REQUEST');
    },
  );

  it.each([
    ['not base64 JSON', 'not-a-cursor'],
    ['a bad id', raw({ at: '2026-06-10T09:30:15Z', id: 'y' })],
    ['a missing id', raw({ at: '2026-06-10T09:30:15Z' })],
    ['a non-object', raw('x')],
  ])('refuses %s', (_name, cursor) => {
    expect(codeOf(cursor)).toBe('BAD_REQUEST');
  });
});
