import { expect, it } from 'vitest';
import { validInAppTemplate, lateServiceSession, type SafeParameter } from '../index.ts';
const names: SafeParameter[] = [
  { name: 'branch_name_ar', type: 'text', value: 'فرع 2026' },
  { name: 'branch_name_en', type: 'text', value: 'Branch 2026' },
  { name: 'business_date', type: 'text', value: '2026-10-14' },
];
it.each(['ar', 'en'])('revision-one template renders %s with strict date safety', (locale) => {
  expect(validInAppTemplate('late_service_session', 1, locale, names)).toBe(true);
  expect(lateServiceSession.copy[locale as 'ar' | 'en']).toContain('{{business_date}}');
  expect(validInAppTemplate('late_service_session', 2, locale, names)).toBe(false);
  expect(validInAppTemplate('late_service_session', 1, locale, names.slice(1))).toBe(false);
});
it.each([
  '2026-02-29',
  '2026-04-31',
  '2026-13-01',
  '999999998123',
  'https://example.test',
  '2026-1-1',
])('date %s fails separate calendar validation', (value) => {
  expect(
    validInAppTemplate('late_service_session', 1, 'ar', [
      ...names.slice(0, 2),
      { name: 'business_date', type: 'text', value },
    ]),
  ).toBe(false);
});
it.each(['+999999998123', '٩٩٩ ٩٩٩ ٩٩٨ ١٢٣', 'https://example.test', 'otp', '1234'])(
  'unsafe name %s is rejected again by notifications',
  (value) => {
    expect(
      validInAppTemplate('late_service_session', 1, 'ar', [
        { name: 'branch_name_ar', type: 'text', value },
        ...names.slice(1),
      ]),
    ).toBe(false);
  },
);
