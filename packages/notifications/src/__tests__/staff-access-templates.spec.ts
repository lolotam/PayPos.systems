import { expect, it } from 'vitest';

import {
  staffAccessGranted,
  staffPinRecovered,
  staffPinSetByOther,
  validInAppTemplate,
  type SafeParameter,
} from '../index.ts';

const parameters: readonly SafeParameter[] = [
  { name: 'employee_name_ar', type: 'text', value: 'سارة' },
  { name: 'employee_name_en', type: 'text', value: 'Sara' },
  { name: 'actor_name_ar', type: 'text', value: 'هبة' },
  { name: 'actor_name_en', type: 'text', value: 'Heba' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'occurred_date', type: 'text', value: '2026-11-25' },
  { name: 'occurred_time', type: 'text', value: '09:30' },
];

const keys = ['staff_access_granted', 'staff_pin_set_by_other', 'staff_pin_recovered'] as const;

it.each(keys)('accepts the %s bell in ar and en', (key) => {
  expect(validInAppTemplate(key, 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate(key, 1, 'en', parameters)).toBe(true);
});

it.each(keys)('refuses the %s bell in another revision', (key) => {
  expect(validInAppTemplate(key, 2, 'ar', parameters)).toBe(false);
  expect(validInAppTemplate(key, 0, 'en', parameters)).toBe(false);
});

it.each(keys)('refuses the %s bell with an unsafe name', (key) => {
  for (const value of ['https://example.test/private', '+96500000001', '123456', '00000001']) {
    for (const name of ['employee_name_ar', 'actor_name_en', 'branch_name_ar']) {
      expect(
        validInAppTemplate(
          key,
          1,
          'ar',
          parameters.map((parameter) =>
            parameter.name === name ? { ...parameter, value } : parameter,
          ),
        ),
      ).toBe(false);
    }
  }
});

it.each(keys)('refuses the %s bell with a bad date or time', (key) => {
  for (const value of ['25-11-2026', '2026-13-25', '2026-11-32']) {
    expect(
      validInAppTemplate(
        key,
        1,
        'ar',
        parameters.map((parameter) =>
          parameter.name === 'occurred_date' ? { ...parameter, value } : parameter,
        ),
      ),
    ).toBe(false);
  }
  for (const value of ['24:00', '9:30', '09:60', '0930']) {
    expect(
      validInAppTemplate(
        key,
        1,
        'en',
        parameters.map((parameter) =>
          parameter.name === 'occurred_time' ? { ...parameter, value } : parameter,
        ),
      ),
    ).toBe(false);
  }
});

it.each(keys)('refuses the %s bell with an extra parameter', (key) => {
  const extras: readonly SafeParameter[] = [
    { name: 'pin', type: 'text', value: '1234' },
    { name: 'phone', type: 'text', value: '+96500000001' },
  ];
  for (const extra of extras) {
    expect(validInAppTemplate(key, 1, 'ar', [...parameters, extra])).toBe(false);
  }
  expect(validInAppTemplate(key, 1, 'ar', parameters.slice(0, 7))).toBe(false);
});

it('publishes both bells as utility templates with the same ordered parameters', () => {
  expect(staffAccessGranted).toMatchObject({
    key: 'staff_access_granted',
    revision: 1,
    locales: ['ar', 'en'],
    category: 'UTILITY',
  });
  expect(staffPinSetByOther).toMatchObject({
    key: 'staff_pin_set_by_other',
    revision: 1,
    locales: ['ar', 'en'],
    category: 'UTILITY',
  });
  expect(staffPinRecovered).toMatchObject({
    key: 'staff_pin_recovered',
    revision: 1,
    locales: ['ar', 'en'],
    category: 'UTILITY',
  });
  expect(staffAccessGranted.parameters.map((parameter) => parameter.name)).toEqual(
    staffPinSetByOther.parameters.map((parameter) => parameter.name),
  );
  expect(staffAccessGranted.parameters.map((parameter) => parameter.name)).toEqual([
    'employee_name_ar',
    'employee_name_en',
    'actor_name_ar',
    'actor_name_en',
    'branch_name_ar',
    'branch_name_en',
    'occurred_date',
    'occurred_time',
  ]);
  expect(staffAccessGranted.parameters.map((parameter) => parameter.textKind)).toEqual([
    'display_name',
    'display_name',
    'display_name',
    'display_name',
    'display_name',
    'display_name',
    'date',
    'time',
  ]);
});

it.each(keys)('keeps the %s copy free of a PIN, a phone or a token', (key) => {
  const copy =
    key === 'staff_access_granted'
      ? staffAccessGranted.copy
      : key === 'staff_pin_set_by_other'
        ? staffPinSetByOther.copy
        : staffPinRecovered.copy;
  for (const locale of ['ar', 'en'] as const) {
    expect(copy[locale]).not.toMatch(/\b\d{4,8}\b/);
    expect(copy[locale]).not.toMatch(/\+?\d{7,}/);
    expect(copy[locale]).not.toMatch(/token|bearer|otp/i);
  }
  expect(staffAccessGranted.copy.ar).toContain('{{actor_name_ar}}');
  expect(staffPinSetByOther.copy.en).toContain('{{actor_name_en}}');
  expect(staffPinRecovered.copy.ar).toContain('{{employee_name_ar}}');
  expect(staffPinRecovered.copy.en).toContain('{{employee_name_en}}');
});
