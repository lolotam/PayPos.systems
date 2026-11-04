import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  assertDiscountSelfApprovalEventValues,
  discountSelfApprovalRecipientGroups,
  maxSelfApprovalEffectiveBps,
  selfApprovalMaxPercentText,
  selfApprovalNoticeParameters,
  type DiscountSelfApprovalParameterInput,
  type SelfApprovalProposalValues,
} from '../discount-self-approval-notice.ts';

const fallback: DiscountSelfApprovalParameterInput['fallback'] = {
  service: { ar: 'الخدمة', en: 'Service' },
  branch: { ar: 'فرع', en: 'Branch' },
  approver: { ar: 'مستخدم', en: 'User' },
  safeName: safeDisplayName,
};
const base = {
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  approver: { labelAr: 'أم فهد', labelEn: 'Am Fahd' },
  service: { nameAr: 'رموش', nameEn: 'Lashes' },
  maxEffectiveBps: 2500,
  fallback,
} satisfies DiscountSelfApprovalParameterInput;
const proposal = (id: string, effectiveBps: number): SelfApprovalProposalValues => ({
  id,
  effectiveBps,
});

it.each([
  { bps: 100, text: '1' },
  { bps: 1050, text: '10.5' },
  { bps: 2050, text: '20.5' },
  { bps: 10000, text: '100' },
])('bps $bps becomes the percent text $text', ({ bps, text }) => {
  expect(selfApprovalMaxPercentText(bps)).toBe(text);
});

it.each([0, -1, 10001, 1.5, Number.NaN])(
  'rejects the bps %s with the self-approval code',
  (bps) => {
    expect(() => selfApprovalMaxPercentText(bps)).toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  },
);

it('passes the template order: branch, approver, service and the largest percent', () => {
  const parameters = selfApprovalNoticeParameters(base);
  expect(parameters.map((item) => item.name)).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'approver_name_ar',
    'approver_name_en',
    'service_name_ar',
    'service_name_en',
    'max_percent',
  ]);
  expect(parameters.map((item) => item.value)).toEqual([
    'فرع سالم',
    'Salem',
    'أم فهد',
    'Am Fahd',
    'رموش',
    'Lashes',
    '25',
  ]);
});

it('picks the first flagged service and the largest percent across proposals', () => {
  const max = maxSelfApprovalEffectiveBps([
    proposal('a', 1000),
    proposal('b', 2500),
    proposal('c', 1050),
  ]);
  expect(max).toBe(2500);
  const parameters = selfApprovalNoticeParameters({
    ...base,
    maxEffectiveBps: max,
    service: { nameAr: null, nameEn: 'Colour' },
  });
  expect(parameters[4]?.['value']).toBe('Colour');
  expect(parameters[5]?.['value']).toBe('Colour');
  expect(parameters[6]?.['value']).toBe('25');
});

it.each(['+999999998123', '٩٩٩ ٩٩٩ ٩٨ ١٢٣', 'example.test', 'https://example.test', '1234'])(
  'an unsafe approver label %s falls back per locale, never empty',
  (label) => {
    const values = selfApprovalNoticeParameters({
      ...base,
      approver: { labelAr: label, labelEn: label },
    }).map((item) => item.value);
    expect(values.slice(2, 4)).toEqual(['مستخدم', 'User']);
  },
);

it('the approver Arabic label may fall back to the English snapshot, English never falls back to Arabic', () => {
  const values = selfApprovalNoticeParameters({
    ...base,
    approver: { labelAr: 'https://example.test', labelEn: 'Am Fahd' },
  }).map((item) => item.value);
  expect(values.slice(2, 4)).toEqual(['Am Fahd', 'Am Fahd']);
  const rejected = selfApprovalNoticeParameters({
    ...base,
    approver: { labelAr: 'أم فهد', labelEn: 'https://example.test' },
  }).map((item) => item.value);
  expect(rejected.slice(2, 4)).toEqual(['أم فهد', 'User']);
});

it('rejects an event with an impossible count, duplicates or an impossible bps', () => {
  expect(() => assertDiscountSelfApprovalEventValues([])).toThrow(
    'DISCOUNT_SELF_APPROVAL_EVENT_INVALID',
  );
  expect(() =>
    assertDiscountSelfApprovalEventValues(
      Array.from({ length: 21 }, (_, i) => proposal(`${i}`, 100)),
    ),
  ).toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(() =>
    assertDiscountSelfApprovalEventValues([proposal('a', 1000), proposal('a', 1000)]),
  ).toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(() => assertDiscountSelfApprovalEventValues([proposal('a', 0)])).toThrow(
    'DISCOUNT_SELF_APPROVAL_EVENT_INVALID',
  );
  expect(() => assertDiscountSelfApprovalEventValues([proposal('a', 10001)])).toThrow(
    'DISCOUNT_SELF_APPROVAL_EVENT_INVALID',
  );
  expect(() => assertDiscountSelfApprovalEventValues([proposal('a', 1.5)])).toThrow(
    'DISCOUNT_SELF_APPROVAL_EVENT_INVALID',
  );
});

it.each([0, 1, 100, 101, 250])('stable groups cover %s users exactly once', (count) => {
  const users = Array.from(
    { length: count },
    (_, index) => `user-${String(index).padStart(3, '0')}`,
  );
  const { groups, recipientCount } = discountSelfApprovalRecipientGroups(
    [...users].reverse().concat(users),
  );
  expect(recipientCount).toBe(count);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    count === 250 ? [100, 100, 50] : count === 101 ? [100, 1] : count === 0 ? [] : [count],
  );
});
