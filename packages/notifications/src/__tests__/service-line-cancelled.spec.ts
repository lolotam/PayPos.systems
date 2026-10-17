import { expect, it } from 'vitest';
import { serviceLineCancelled, validInAppTemplate, type SafeParameter } from '../index.ts';

const parameters: SafeParameter[] = [
  { name: 'service_name_ar', type: 'text', value: 'قص' },
  { name: 'service_name_en', type: 'text', value: 'Cut' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'business_date', type: 'text', value: '2026-10-16' },
  { name: 'cancelled_net', type: 'text', value: '20.000' },
];
const replaced = (name: string, value: string): SafeParameter[] =>
  parameters.map((parameter) => (parameter.name === name ? { ...parameter, value } : parameter));

it.each(['ar', 'en'])('revision-one template renders %s', (locale) => {
  expect(validInAppTemplate('service_line_cancelled', 1, locale, parameters)).toBe(true);
});
it.each(['2.500', '125.000', '1250.000'])('money %s is accepted on the template path', (amount) => {
  expect(
    validInAppTemplate('service_line_cancelled', 1, 'ar', replaced('cancelled_net', amount)),
  ).toBe(true);
  expect(
    validInAppTemplate('service_line_cancelled', 1, 'en', replaced('cancelled_net', amount)),
  ).toBe(true);
});
it('copy placeholders are exactly the parameter names and carry no identity', () => {
  const names = serviceLineCancelled.parameters.map((parameter) => parameter.name);
  const placeholders = [
    ...serviceLineCancelled.copy.ar.matchAll(/\{\{([a-z_]+)\}\}/g),
    ...serviceLineCancelled.copy.en.matchAll(/\{\{([a-z_]+)\}\}/g),
  ].map((match) => match[1]);
  expect([...new Set(placeholders)].sort()).toEqual([...names].sort());
  expect(names).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'cancelled_net',
  ]);
  const copy = `${serviceLineCancelled.copy.ar}\n${serviceLineCancelled.copy.en}`;
  expect(copy).not.toMatch(/canceller|editor|reason|identity/i);
  expect(names.join(' ')).not.toMatch(/canceller|editor|reason/);
});
