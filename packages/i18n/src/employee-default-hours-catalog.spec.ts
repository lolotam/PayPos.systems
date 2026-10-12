import { expect, it } from 'vitest';
import { t } from './index.js';

it.each([
  ['en', 'Same hours for all days', 'Days off', 'Apply to working days'],
  ['ar', 'نفس المواعيد لكل الأيام', 'أيام الإجازة', 'تطبيق على أيام الشغل'],
] as const)('translates the same-hours action and days off in %s', (locale, action, daysOff, apply) => {
  expect(t(locale, 'employeeDefaultHours.sameHours')).toBe(action);
  expect(t(locale, 'employeeDefaultHours.daysOff')).toBe(daysOff);
  expect(t(locale, 'employeeDefaultHours.applyHours')).toBe(apply);
});
