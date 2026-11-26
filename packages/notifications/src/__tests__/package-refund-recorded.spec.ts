import { expect, it } from 'vitest';
import { packageRefundRecorded, validInAppTemplate, type SafeParameter } from '../index.ts';

const parameters: SafeParameter[] = [
  { name: 'package_name_ar', type: 'text', value: 'باقة شعر' },
  { name: 'package_name_en', type: 'text', value: 'Hair package' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'sessions', type: 'text', value: '3' },
  { name: 'amount', type: 'text', value: '20.000' },
  { name: 'business_date', type: 'text', value: '2026-11-20' },
];
const replaced = (name: string, value: string): SafeParameter[] =>
  parameters.map((parameter) => (parameter.name === name ? { ...parameter, value } : parameter));

it.each(['ar', 'en'])('revision-one template renders %s', (locale) => {
  expect(validInAppTemplate('package_refund_recorded', 1, locale, parameters)).toBe(true);
});

it('a wrong revision or a missing parameter is refused', () => {
  expect(validInAppTemplate('package_refund_recorded', 2, 'ar', parameters)).toBe(false);
  expect(validInAppTemplate('package_refund_recorded', 1, 'ar', parameters.slice(1))).toBe(false);
});

it.each(['2.500', '125.000', '1250.000'])('money %s is accepted on the template path', (amount) => {
  expect(validInAppTemplate('package_refund_recorded', 1, 'ar', replaced('amount', amount))).toBe(
    true,
  );
  expect(validInAppTemplate('package_refund_recorded', 1, 'en', replaced('amount', amount))).toBe(
    true,
  );
});

it('copy placeholders are exactly the parameter names and carry no identity', () => {
  const names = packageRefundRecorded.parameters.map((parameter) => parameter.name);
  const placeholders = [
    ...packageRefundRecorded.copy.ar.matchAll(/\{\{([a-z_]+)\}\}/g),
    ...packageRefundRecorded.copy.en.matchAll(/\{\{([a-z_]+)\}\}/g),
  ].map((match) => match[1]);
  expect([...new Set(placeholders)].sort()).toEqual([...names].sort());
  expect(names).toEqual([
    'package_name_ar',
    'package_name_en',
    'branch_name_ar',
    'branch_name_en',
    'sessions',
    'amount',
    'business_date',
  ]);
  const copy = `${packageRefundRecorded.copy.ar}\n${packageRefundRecorded.copy.en}`;
  expect(copy).not.toMatch(/reason|customer|phone|refunded_by/i);
  expect(names.join(' ')).not.toMatch(/reason|customer|phone/);
});
