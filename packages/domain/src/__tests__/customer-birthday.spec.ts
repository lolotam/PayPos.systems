import { describe, expect, it } from 'vitest';

import { isValidCustomerBirthdayCalendar } from '../customer-birthday.js';

describe('isValidCustomerBirthdayCalendar', () => {
  it.each([
    ['a day and month without a year', { day: 5, month: 3 }],
    ['29 February without a year', { day: 29, month: 2 }],
    ['a full date in a leap year', { day: 29, month: 2, year: 2024 }],
    ['the 400-year leap rule', { day: 29, month: 2, year: 2000 }],
    ['the first of January', { day: 1, month: 1, year: 1 }],
    ['the last day of a 31-day month', { day: 31, month: 12, year: 9999 }],
  ])('accepts %s', (_case, birthday) => {
    expect(isValidCustomerBirthdayCalendar(birthday)).toBe(true);
  });

  it.each([
    ['a day without its month', { day: 5 }],
    ['a month without its day', { month: 3 }],
    ['a year alone', { year: 1990 }],
    ['a day that does not exist in February', { day: 30, month: 2 }],
    ['a day that does not exist in a 30-day month', { day: 31, month: 4 }],
    ['a day of zero', { day: 0, month: 1 }],
    ['a month of zero', { day: 1, month: 0 }],
    ['a month of thirteen', { day: 1, month: 13 }],
    ['a fractional day', { day: 5.5, month: 3 }],
    ['a fractional month', { day: 5, month: 3.5 }],
    ['a fractional year', { day: 5, month: 3, year: 1990.5 }],
    ['a year of zero', { day: 1, month: 1, year: 0 }],
    ['a year above four digits', { day: 1, month: 1, year: 10000 }],
    ['29 February in a century that is not a leap year', { day: 29, month: 2, year: 1900 }],
    ['29 February in a non-leap year', { day: 29, month: 2, year: 2100 }],
    ['a string day', { day: '5', month: 3 }],
  ])('refuses %s', (_case, birthday) => {
    expect(isValidCustomerBirthdayCalendar(birthday as never)).toBe(false);
  });

  it('is pure: the same input always gives the same answer and does not mutate it', () => {
    const birthday = { day: 29, month: 2, year: 2000 } as const;
    expect(isValidCustomerBirthdayCalendar(birthday)).toBe(true);
    expect(isValidCustomerBirthdayCalendar(birthday)).toBe(true);
    expect(birthday).toEqual({ day: 29, month: 2, year: 2000 });
  });
});
