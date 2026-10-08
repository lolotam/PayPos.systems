import { expect, it } from 'vitest';

import { validInAppTemplate } from '../index.ts';

it.each([
  '123456',
  ' 123456 ',
  'https://example.test/private',
  'www.example.test',
  'example.test',
  '+96500000001',
  '00000001',
  '0000 0001',
  '٠٠٠٠ ٠٠٠١',
  'Synthetic 00000001',
  ' ',
])('rejects unsafe display names: %s', (value) => {
  const parameters = [
    'employee_name_ar',
    'employee_name_en',
    'branch_name_ar',
    'branch_name_en',
  ].map((name) => ({ name, type: 'text' as const, value }));
  expect(
    validInAppTemplate('shift_not_clocked_in', 1, 'ar', [
      ...parameters,
      { name: 'shift_start', type: 'text', value: '10:00' },
    ]),
  ).toBe(false);
});

it('allows the safe in-app templates in supported locales and revision', () => {
  const values = [{ name: 'subject', type: 'text' as const, value: 'Synthetic subject' }];
  const shift = [
    { name: 'employee_name_ar', type: 'text' as const, value: 'Synthetic employee' },
    { name: 'employee_name_en', type: 'text' as const, value: 'Synthetic employee' },
    { name: 'branch_name_ar', type: 'text' as const, value: 'Studio 2026' },
    { name: 'branch_name_en', type: 'text' as const, value: 'Studio 2026' },
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
  expect(
    validInAppTemplate('shift_not_clocked_in', 1, 'ar', [
      ...shift.slice(0, 2),
      { name: 'branch_name_ar', type: 'text', value: '123456' },
      ...shift.slice(3),
    ]),
  ).toBe(false);
  expect(
    validInAppTemplate('shift_not_clocked_in', 1, 'ar', [
      { name: 'employee_name_ar', type: 'text', value: 'Synthetic employee' },
      { name: 'employee_name_en', type: 'text', value: 'Synthetic employee' },
      { name: 'branch_name_ar', type: 'text', value: 'Studio 2026' },
      { name: 'branch_name_en', type: 'text', value: 'https://example.test/private' },
      { name: 'shift_start', type: 'text', value: '10:00' },
    ]),
  ).toBe(false);
  expect(validInAppTemplate('generic_notice', 1, 'ar', [])).toBe(false);
  expect(
    validInAppTemplate('generic_notice', 1, 'ar', [
      { name: 'unknown', type: 'text', value: 'Synthetic subject' },
    ]),
  ).toBe(false);
});
