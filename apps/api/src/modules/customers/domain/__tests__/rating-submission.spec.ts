import { describe, expect, it } from 'vitest';

import {
  isLowRating,
  isRatingViewable,
  ratingBusinessName,
  ratingViewStateOf,
} from '../rating-submission.ts';

const EXPIRES_AT = new Date('2026-06-08T00:00:00Z');

describe('the rating view state', () => {
  it.each([
    { consumedAt: null, expected: 'open' },
    { consumedAt: new Date('2026-06-02T00:00:00Z'), expected: 'submitted' },
  ])('reads $expected from $consumedAt', ({ consumedAt, expected }) => {
    expect(ratingViewStateOf(consumedAt)).toBe(expected);
  });
});

describe('the rating view expiry check', () => {
  it.each([
    { label: 'one millisecond before', now: new Date(EXPIRES_AT.getTime() - 1), expected: true },
    { label: 'exactly at', now: EXPIRES_AT, expected: false },
    { label: 'one millisecond after', now: new Date(EXPIRES_AT.getTime() + 1), expected: false },
  ])('$label the expiry is viewable: $expected', ({ now, expected }) => {
    expect(isRatingViewable(EXPIRES_AT, now)).toBe(expected);
  });
});

const BUSINESS_NAMES: readonly {
  locale: 'ar' | 'en';
  nameAr: string | null;
  nameEn: string;
  expected: string;
}[] = [
  { locale: 'ar', nameAr: 'صالون النخيل', nameEn: 'Palm Salon', expected: 'صالون النخيل' },
  { locale: 'ar', nameAr: null, nameEn: 'Palm Salon', expected: 'Palm Salon' },
  { locale: 'ar', nameAr: '', nameEn: 'Palm Salon', expected: 'Palm Salon' },
  { locale: 'ar', nameAr: '   ', nameEn: 'Palm Salon', expected: 'Palm Salon' },
  { locale: 'en', nameAr: 'صالون النخيل', nameEn: 'Palm Salon', expected: 'Palm Salon' },
  { locale: 'en', nameAr: null, nameEn: 'Palm Salon', expected: 'Palm Salon' },
];

describe('the rating business name', () => {
  it.each(BUSINESS_NAMES)('picks the $locale name', ({ locale, nameAr, nameEn, expected }) => {
    expect(ratingBusinessName(locale, nameAr, nameEn)).toBe(expected);
  });
});

describe('the low rating check', () => {
  it.each([
    { stars: 1, expected: true },
    { stars: 2, expected: true },
    { stars: 3, expected: false },
    { stars: 4, expected: false },
    { stars: 5, expected: false },
  ])('$stars stars is low: $expected', ({ stars, expected }) => {
    expect(isLowRating(stars)).toBe(expected);
  });
});
