import { expect, it } from 'vitest';
import {
  discountApprovalRequested,
  discountSelfApproved,
  validInAppTemplate,
  type SafeParameter,
} from '../index.ts';

const parameters: SafeParameter[] = [
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'service_name_ar', type: 'text', value: 'صبغة' },
  { name: 'service_name_en', type: 'text', value: 'Colour' },
  { name: 'line_count', type: 'text', value: '3' },
  { name: 'max_percent', type: 'text', value: '20.5' },
];
const replaced = (name: string, value: string): SafeParameter[] =>
  parameters.map((parameter) => (parameter.name === name ? { ...parameter, value } : parameter));

it.each(['ar', 'en'])('revision-one template renders %s', (locale) => {
  expect(validInAppTemplate('discount_approval_requested', 1, locale, parameters)).toBe(true);
});
it('refuses a raw four-digit bps and a phone where a name belongs', () => {
  expect(validInAppTemplate('discount_approval_requested', 1, 'ar', replaced('max_percent', '2000'))).toBe(false);
  expect(validInAppTemplate('discount_approval_requested', 1, 'ar', replaced('service_name_en', '+96550000000'))).toBe(false);
});
it('copy placeholders are exactly the parameter names and carry no customer or requester', () => {
  const names = discountApprovalRequested.parameters.map((parameter) => parameter.name);
  const placeholders = [
    ...discountApprovalRequested.copy.ar.matchAll(/\{\{([a-z_]+)\}\}/g),
    ...discountApprovalRequested.copy.en.matchAll(/\{\{([a-z_]+)\}\}/g),
  ].map((match) => match[1]);
  expect([...new Set(placeholders)].sort()).toEqual([...names].sort());
  expect(names).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'service_name_ar',
    'service_name_en',
    'line_count',
    'max_percent',
  ]);
  expect(names.join(' ')).not.toMatch(/customer|phone|requester|pin/);
});

const performerApproval: SafeParameter[] = [
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'approver_name_ar', type: 'text', value: 'هبة' },
  { name: 'approver_name_en', type: 'text', value: 'Heba' },
  { name: 'service_name_ar', type: 'text', value: 'صبغة' },
  { name: 'service_name_en', type: 'text', value: 'Colour' },
  { name: 'max_percent', type: 'text', value: '30' },
];
it.each(['ar', 'en'])('the owner bell for a performer approval renders %s', (locale) => {
  expect(validInAppTemplate('discount_self_approved', 1, locale, performerApproval)).toBe(true);
});
it('the owner bell placeholders are exactly its parameters and carry no customer', () => {
  const names = discountSelfApproved.parameters.map((parameter) => parameter.name);
  const placeholders = [
    ...discountSelfApproved.copy.ar.matchAll(/\{\{([a-z_]+)\}\}/g),
    ...discountSelfApproved.copy.en.matchAll(/\{\{([a-z_]+)\}\}/g),
  ].map((match) => match[1]);
  expect([...new Set(placeholders)].sort()).toEqual([...names].sort());
  expect(names.join(' ')).not.toMatch(/customer|phone|pin/);
});
