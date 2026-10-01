import { expect, it } from 'vitest';

import { validInAppTemplate } from '../index.ts';

it('only allows the safe ordered generic template in supported locales/revision', () => {
  const values = [{ name: 'subject', type: 'text' as const, value: 'Synthetic subject' }];
  for (const locale of ['ar', 'en'])
    expect(validInAppTemplate('generic_notice', 1, locale, values)).toBe(true);
  for (const [key, revision, locale] of [
    ['staff_otp', 1, 'ar'],
    ['generic_notice', 2, 'ar'],
    ['generic_notice', 1, 'fr'],
  ] as const)
    expect(validInAppTemplate(key, revision, locale, values)).toBe(false);
  for (const value of [
    '',
    'https://example.test/private',
    'bearer secret',
    '123456',
    '+96500000001',
  ])
    expect(
      validInAppTemplate('generic_notice', 1, 'ar', [{ name: 'subject', type: 'text', value }]),
    ).toBe(false);
  expect(validInAppTemplate('generic_notice', 1, 'ar', [])).toBe(false);
  expect(
    validInAppTemplate('generic_notice', 1, 'ar', [
      { name: 'unknown', type: 'text', value: 'Synthetic subject' },
    ]),
  ).toBe(false);
});
