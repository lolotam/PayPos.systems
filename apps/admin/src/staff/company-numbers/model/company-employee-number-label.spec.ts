import { expect, it } from 'vitest';
import { companyEmployeeNumberLabel } from './company-employee-number-label';

const named = { name_ar: 'هبة', name_en: 'Heba' };

it('shows the English name in English and the Arabic name in Arabic', () => {
  expect(companyEmployeeNumberLabel(named, 'en')).toBe('Heba');
  expect(companyEmployeeNumberLabel(named, 'ar')).toBe('هبة');
});

it('falls back to English when Arabic is missing or blank', () => {
  expect(companyEmployeeNumberLabel({ name_ar: null, name_en: 'Heba' }, 'ar')).toBe('Heba');
  expect(companyEmployeeNumberLabel({ name_ar: '   ', name_en: 'Heba' }, 'ar')).toBe('Heba');
});
