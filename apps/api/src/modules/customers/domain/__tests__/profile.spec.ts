import { describe, expect, it } from 'vitest';

import { InvalidCustomerProfileError } from '../errors.ts';
import { isEmailShape, isNoteShape, noteLength, validateBirthday } from '../profile.ts';

describe('validateBirthday', () => {
  it.each([
    ['a day and a month without a year', { day: 5, month: 3 }],
    ['a full date in a leap year', { day: 29, month: 2, year: 2024 }],
    ['the 29th of February without a year', { day: 29, month: 2 }],
    ['a day that exists in its month', { day: 31, month: 12 }],
    ['the first of January', { day: 1, month: 1 }],
  ])('accepts %s', (_case, birthday) => {
    expect(() => validateBirthday(birthday)).not.toThrow();
  });

  it.each([
    ['a day without its month', { day: 5 }],
    ['a month without its day', { month: 3 }],
    ['a day that does not exist in its month', { day: 30, month: 2 }],
    ['a day that does not exist in a 30 day month', { day: 31, month: 4 }],
    ['a day that does not exist in a 31 day month', { day: 32, month: 1 }],
    ['a day of zero', { day: 0, month: 1 }],
    ['a month of zero', { day: 1, month: 0 }],
    ['a month of thirteen', { day: 1, month: 13 }],
    ['the 29th of February in a year that is not a leap year', { day: 29, month: 2, year: 1900 }],
    [
      'the 29th of February in a century that is not a leap year',
      { day: 29, month: 2, year: 2100 },
    ],
    ['a year of zero', { day: 1, month: 1, year: 0 }],
    ['a year of ten thousand', { day: 1, month: 1, year: 10000 }],
    ['a fractional day', { day: 5.5, month: 3 }],
    ['a fractional month', { day: 5, month: 3.5 }],
    ['a fractional year', { day: 5, month: 3, year: 1990.5 }],
  ])('refuses %s', (_case, birthday) => {
    expect(() => validateBirthday(birthday)).toThrow(InvalidCustomerProfileError);
  });

  it('accepts the 29th of February in 2000, because 2000 is a leap year by the 400 rule', () => {
    expect(() => validateBirthday({ day: 29, month: 2, year: 2000 })).not.toThrow();
  });

  it('keeps the value out of the error message', () => {
    try {
      validateBirthday({ day: 30, month: 2 });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('INVALID_CUSTOMER_PROFILE');
      expect((error as Error).message).not.toContain('30');
    }
  });
});

describe('isEmailShape', () => {
  it.each([
    ['a normal address', 'a@b.test'],
    ['the shortest allowed address', 'a@.'],
    ['an address with a subdomain', 'first.last@mail.example.test'],
    ['an address with a plus tag', 'first+tag@mail.example.test'],
    ['an address of exactly 254 characters', `${'a'.repeat(252)}@.`],
  ])('accepts %s', (_case, value) => {
    expect(isEmailShape(value)).toBe(true);
  });

  it.each([
    ['an address without an @', 'ab.test'],
    ['an address without a dot', 'a@bt'],
    ['an address shorter than three characters', 'a.'],
    ['an address longer than 254 characters', `${'a'.repeat(253)}@.`],
    ['an address with outer spaces', ' a@b.test'],
    ['an address with a control character', `a@b.te${String.fromCharCode(1)}st`],
    ['an address with a line break', 'a@b.test\n'],
  ])('refuses %s', (_case, value) => {
    expect(isEmailShape(value)).toBe(false);
  });

  it('counts the ceiling in code points, not in UTF-16 units', () => {
    expect(isEmailShape(`😀${'a'.repeat(251)}@.`)).toBe(true);
  });
});

describe('noteLength and isNoteShape', () => {
  it('counts the note in code points', () => {
    expect(noteLength('abc')).toBe(3);
    expect(noteLength('😀')).toBe(1);
    expect(noteLength('😀😀')).toBe(2);
    expect(noteLength('x'.repeat(500))).toBe(500);
  });

  it.each([
    ['a normal note', 'Prefers the window seat'],
    ['a note with interior newlines', 'first line\nsecond line'],
    ['a note of exactly 500 characters', 'x'.repeat(500)],
  ])('accepts %s', (_case, value) => {
    expect(isNoteShape(value)).toBe(true);
  });

  it.each([
    ['an empty note', ''],
    ['a note of spaces only', '   '],
    ['a note longer than 500 characters', 'x'.repeat(501)],
    ['a note with outer spaces', ' padded '],
    ['a note with a NUL', `a${String.fromCharCode(0)}b`],
  ])('refuses %s', (_case, value) => {
    expect(isNoteShape(value)).toBe(false);
  });
});
