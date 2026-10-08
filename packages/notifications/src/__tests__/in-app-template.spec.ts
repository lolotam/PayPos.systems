import { expect, it } from 'vitest';

import { validInAppTemplate } from '../index.ts';

it('allows the safe in-app templates in supported locales and revision', () => {
  const values = [{ name: 'subject', type: 'text' as const, value: 'Synthetic subject' }];
  const shift = [
    { name: 'employee_name', type: 'text' as const, value: 'Synthetic employee' },
    { name: 'branch_name', type: 'text' as const, value: 'Synthetic branch' },
    { name: 'shift_start', type: 'text' as const, value: '10:00' },
  ];
  for (const locale of ['ar', 'en']) {
    expect(validInAppTemplate('generic_notice', 1, locale, values)).toBe(true);
    expect(validInAppTemplate('shift_not_clocked_in', 1, locale, shift)).toBe(true);
  }
  expect(validInAppTemplate('shift_not_clocked_in', 1, 'ar', values)).toBe(false);
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
