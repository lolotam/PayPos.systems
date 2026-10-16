import { expect, it } from 'vitest';
import { serviceLinePriceEdited, validInAppTemplate, type SafeParameter } from '../index.ts';

const parameters: SafeParameter[] = [
  { name: 'service_name_ar', type: 'text', value: 'قص' },
  { name: 'service_name_en', type: 'text', value: 'Cut' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'business_date', type: 'text', value: '2026-10-16' },
  { name: 'previous_net', type: 'text', value: '25.000' },
  { name: 'new_net', type: 'text', value: '20.000' },
  { name: 'editor_name_ar', type: 'text', value: 'ليلى' },
  { name: 'editor_name_en', type: 'text', value: 'Laila' },
];
const replaced = (name: string, value: string): SafeParameter[] =>
  parameters.map((parameter) => (parameter.name === name ? { ...parameter, value } : parameter));

it.each(['ar', 'en'])('revision-one template renders %s', (locale) => {
  expect(validInAppTemplate('service_line_price_edited', 1, locale, parameters)).toBe(true);
});
it('revision 2, a missing parameter and a reordered parameter are rejected', () => {
  expect(validInAppTemplate('service_line_price_edited', 2, 'ar', parameters)).toBe(false);
  expect(validInAppTemplate('service_line_price_edited', 1, 'ar', parameters.slice(1))).toBe(false);
  const previousNet = parameters[5];
  const newNet = parameters[6];
  if (previousNet === undefined || newNet === undefined) throw new Error('fixture');
  const reordered = [newNet, previousNet, ...parameters.filter((_, index) => index !== 5 && index !== 6)];
  expect(validInAppTemplate('service_line_price_edited', 1, 'ar', reordered)).toBe(false);
});
it.each(['2.500', '125.000', '1250.000'])('money %s is accepted on the template path', (amount) => {
  expect(validInAppTemplate('service_line_price_edited', 1, 'ar', replaced('previous_net', amount))).toBe(true);
  expect(validInAppTemplate('service_line_price_edited', 1, 'en', replaced('new_net', amount))).toBe(true);
});
it.each(['2.5', '1250', '1250.0000', '+96500000001', 'https://example.test', '-1.000', '١٢٥.٠٠٠'])(
  'money %s is rejected',
  (amount) => {
    expect(validInAppTemplate('service_line_price_edited', 1, 'ar', replaced('previous_net', amount))).toBe(false);
    expect(validInAppTemplate('service_line_price_edited', 1, 'en', replaced('new_net', amount))).toBe(false);
  },
);
it.each(['https://example.test', '+96500000001', '1 2 3 4 5 6 7'])(
  'unsafe name %s is rejected for the service and the editor',
  (value) => {
    for (const name of ['service_name_ar', 'service_name_en', 'editor_name_ar', 'editor_name_en']) {
      expect(validInAppTemplate('service_line_price_edited', 1, 'ar', replaced(name, value))).toBe(false);
    }
  },
);
it.each([
  ['editor_name_ar', 'المالك'],
  ['editor_name_ar', 'المدير'],
  ['editor_name_en', 'Owner'],
  ['editor_name_en', 'Manager'],
])('role label %s is an accepted editor name', (name, value) => {
  expect(validInAppTemplate('service_line_price_edited', 1, 'ar', replaced(name, value))).toBe(true);
});
it('copy placeholders are exactly the parameter names', () => {
  const names = serviceLinePriceEdited.parameters.map((parameter) => parameter.name);
  const placeholders = [...serviceLinePriceEdited.copy.ar.matchAll(/\{\{([a-z_]+)\}\}/g), ...serviceLinePriceEdited.copy.en.matchAll(/\{\{([a-z_]+)\}\}/g)].map(
    (match) => match[1],
  );
  expect([...new Set(placeholders)].sort()).toEqual([...names].sort());
  expect(names).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'previous_net',
    'new_net',
    'editor_name_ar',
    'editor_name_en',
  ]);
});
