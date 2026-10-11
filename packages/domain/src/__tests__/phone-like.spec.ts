import { expect, it } from 'vitest';

import { containsPhoneLikeNumber } from '../phone-like.js';

const arabicIndic = (digits: string) =>
  [...digits].map((d) => String.fromCodePoint(0x0660 + Number(d))).join('');
const extendedArabicIndic = (digits: string) =>
  [...digits].map((d) => String.fromCodePoint(0x06f0 + Number(d))).join('');

it.each([
  '96512345678',
  '+965 1234 5678',
  '+96512345678',
  '965-1234-5678',
  '(965) 1234 5678',
  '9 6 5 1 2 3 4 5 6 7 8',
  'call 1234567 today',
  arabicIndic('96512345678'),
  extendedArabicIndic('96512345678'),
  `${arabicIndic('965')} ${arabicIndic('1234')} ${arabicIndic('5678')}`,
])('flags a phone-like number: %s', (text) => {
  expect(containsPhoneLikeNumber(text)).toBe(true);
});

it.each([
  'shift 3',
  `shift ${arabicIndic('3')}`,
  'came at 10:05 and left at 19:00',
  '123456',
  'room 12, desk 34',
  '',
])('lets a short or non-phone number pass: %s', (text) => {
  expect(containsPhoneLikeNumber(text)).toBe(false);
});
