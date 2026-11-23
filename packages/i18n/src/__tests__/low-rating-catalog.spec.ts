import { expect, it } from 'vitest';
import { t } from '../catalog.js';

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{([a-z_0-9]+)\}\}/g)].map((match) => match[1]).sort();

it('registers the low-rating bell copy with the same placeholders in both locales', () => {
  const expected = ['branch', 'business_date', 'customer', 'performers', 'phone_last3', 'stars'];
  expect(placeholders(t('ar', 'inApp.low_rating_summary'))).toEqual(expected);
  expect(placeholders(t('en', 'inApp.low_rating_summary'))).toEqual(expected);
});

it('has a non-empty label for every low-rating helper key in both locales', () => {
  for (const locale of ['ar', 'en'] as const)
    for (const key of [
      'inApp.low_rating_stars_1',
      'inApp.low_rating_stars_2',
      'inApp.low_rating_generic_customer',
      'inApp.low_rating_names_separator',
      'inApp.low_rating_comment_label',
    ] as const)
      expect(t(locale, key)).not.toBe(key);
});
