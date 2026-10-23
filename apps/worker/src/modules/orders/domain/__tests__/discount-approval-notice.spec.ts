import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  assertDiscountApprovalEventValues,
  discountApprovalNoticeParameters,
  discountApprovalRecipientGroups,
  maxPercentText,
  type DiscountApprovalParameterInput,
} from '../discount-approval-notice.ts';

const fallback: DiscountApprovalParameterInput['fallback'] = {
  service: { ar: 'الخدمة', en: 'Service' },
  branch: { ar: 'فرع', en: 'Branch' },
  safeName: safeDisplayName,
};
const base = {
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  service: { nameAr: 'قص', nameEn: 'Cut' },
  lineCount: 2,
  maxEffectiveBps: 2000,
  serviceCount: 1,
  fallback,
} satisfies DiscountApprovalParameterInput;

it.each([
  { bps: 1, text: '0.01' },
  { bps: 5, text: '0.05' },
  { bps: 10, text: '0.1' },
  { bps: 50, text: '0.5' },
  { bps: 99, text: '0.99' },
  { bps: 100, text: '1' },
  { bps: 101, text: '1.01' },
  { bps: 110, text: '1.1' },
  { bps: 990, text: '9.9' },
  { bps: 1000, text: '10' },
  { bps: 2000, text: '20' },
  { bps: 2010, text: '20.1' },
  { bps: 2050, text: '20.5' },
  { bps: 2055, text: '20.55' },
  { bps: 9990, text: '99.9' },
  { bps: 9999, text: '99.99' },
  { bps: 10000, text: '100' },
])('bps $bps becomes the percent text $text', ({ bps, text }) => {
  expect(maxPercentText(bps)).toBe(text);
});

it.each([0, -1, 10001, 1.5, Number.NaN])('rejects the bps %s', (bps) => {
  expect(() => maxPercentText(bps)).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
});

it('passes the template order: branch, service, line count and the largest percent', () => {
  const parameters = discountApprovalNoticeParameters(base);
  expect(parameters.map((item) => item.name)).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'service_name_ar',
    'service_name_en',
    'line_count',
    'max_percent',
  ]);
  expect(parameters.map((item) => item.value)).toEqual([
    'فرع سالم',
    'Salem',
    'قص',
    'Cut',
    '2',
    '20',
  ]);
});

it.each(['+999999998123', '٩٩٩ ٩٩٩ ٩٨ ١٢٣', 'example.test', 'https://example.test', '1234'])(
  'an unsafe name %s uses the injected fallback',
  (name) => {
    const values = discountApprovalNoticeParameters({
      ...base,
      branch: { nameAr: name, nameEn: name },
      service: { nameAr: null, nameEn: name },
    }).map((item) => item.value);
    expect(values.slice(0, 4)).toEqual(['فرع', 'Branch', 'الخدمة', 'Service']);
  },
);

it('English does not fall back to Arabic', () => {
  const values = discountApprovalNoticeParameters({
    ...base,
    branch: { nameAr: 'فرع سالم', nameEn: 'https://example.test' },
    service: { nameAr: 'قص', nameEn: 'https://example.test' },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['فرع سالم', 'Branch', 'قص', 'Service']);
});

it('rejects an event whose line count, percent or service count is impossible', () => {
  expect(() =>
    assertDiscountApprovalEventValues({ lineCount: 0, maxEffectiveBps: 2000, serviceCount: 1 }),
  ).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
  expect(() =>
    assertDiscountApprovalEventValues({ lineCount: 21, maxEffectiveBps: 2000, serviceCount: 1 }),
  ).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
  expect(() =>
    assertDiscountApprovalEventValues({ lineCount: 2, maxEffectiveBps: 0, serviceCount: 1 }),
  ).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
  expect(() =>
    assertDiscountApprovalEventValues({ lineCount: 2, maxEffectiveBps: 10001, serviceCount: 1 }),
  ).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
  expect(() =>
    assertDiscountApprovalEventValues({ lineCount: 2, maxEffectiveBps: 2000, serviceCount: 3 }),
  ).toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
});

it.each([0, 1, 100, 101, 250])('stable groups cover %s users exactly once', (count) => {
  const users = Array.from(
    { length: count },
    (_, index) => `user-${String(index).padStart(3, '0')}`,
  );
  const { groups, recipientCount } = discountApprovalRecipientGroups(
    [...users].reverse().concat(users),
  );
  expect(recipientCount).toBe(count);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    count === 250 ? [100, 100, 50] : count === 101 ? [100, 1] : count === 0 ? [] : [count],
  );
});
