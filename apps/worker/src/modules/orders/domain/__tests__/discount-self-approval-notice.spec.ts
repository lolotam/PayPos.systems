import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  assertDiscountSelfApprovalEventValues,
  discountSelfApprovalRecipientGroups,
  maxSelfApprovalEffectiveBps,
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
  approver: { labelAr: 'مدير سالم', labelEn: 'Salem Manager' },
  service: { nameAr: 'قص', nameEn: 'Cut' },
  maxEffectiveBps: 2000,
  fallback,
} satisfies DiscountSelfApprovalParameterInput;
const invalidEvent = /^DISCOUNT_SELF_APPROVAL_EVENT_INVALID$/;
const unsafe = 'https://example.test';
const proposal = (id: string, effectiveBps = 100): SelfApprovalProposalValues => ({
  id,
  effectiveBps,
});
const makeProposals = (count: number) =>
  Array.from({ length: count }, (_, index) => proposal(`proposal-${index + 1}`));
const makeUserIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `user-${String(index).padStart(3, '0')}`);
const valuesOf = (input: DiscountSelfApprovalParameterInput) =>
  selfApprovalNoticeParameters(input).map((item) => item.value);

it('builds the seven template parameters in order with the supplied values', () => {
  expect(selfApprovalNoticeParameters(base)).toEqual([
    { name: 'branch_name_ar', type: 'text', value: 'فرع سالم' },
    { name: 'branch_name_en', type: 'text', value: 'Salem' },
    { name: 'approver_name_ar', type: 'text', value: 'مدير سالم' },
    { name: 'approver_name_en', type: 'text', value: 'Salem Manager' },
    { name: 'service_name_ar', type: 'text', value: 'قص' },
    { name: 'service_name_en', type: 'text', value: 'Cut' },
    { name: 'max_percent', type: 'text', value: '20' },
  ]);
});

it.each([
  {
    case: 'missing Arabic names',
    branch: { nameAr: null, nameEn: 'Salem' },
    service: { nameAr: null, nameEn: 'Cut' },
    expected: ['Salem', 'Salem', 'Cut', 'Cut'],
  },
  {
    case: 'unsafe Arabic names',
    branch: { nameAr: unsafe, nameEn: 'Salem' },
    service: { nameAr: unsafe, nameEn: 'Cut' },
    expected: ['Salem', 'Salem', 'Cut', 'Cut'],
  },
  {
    case: 'unsafe Arabic and English names',
    branch: { nameAr: unsafe, nameEn: unsafe },
    service: { nameAr: unsafe, nameEn: unsafe },
    expected: ['فرع', 'Branch', 'الخدمة', 'Service'],
  },
])('resolves $case through the bilingual fallback chain', ({ branch, service, expected }) => {
  const values = valuesOf({ ...base, branch, service });
  expect([values[0], values[1], values[4], values[5]]).toEqual(expected);
});

it('never uses Arabic values as English fallbacks', () => {
  expect(
    valuesOf({
      ...base,
      branch: { nameAr: 'فرع سالم', nameEn: unsafe },
      approver: { labelAr: 'مدير سالم', labelEn: unsafe },
      service: { nameAr: 'قص', nameEn: unsafe },
    }),
  ).toEqual(['فرع سالم', 'Branch', 'مدير سالم', 'User', 'قص', 'Service', '20']);
});

it.each([
  {
    case: 'an unsafe Arabic label',
    approver: { labelAr: unsafe, labelEn: 'Salem Manager' },
    expected: ['Salem Manager', 'Salem Manager'],
  },
  {
    case: 'unsafe Arabic and English labels',
    approver: { labelAr: unsafe, labelEn: unsafe },
    expected: ['مستخدم', 'User'],
  },
])('uses the approver fallback chain for $case', ({ approver, expected }) => {
  expect(valuesOf({ ...base, approver }).slice(2, 4)).toEqual(expected);
});

it.each([
  { bps: 1, text: '0.01' },
  { bps: 50, text: '0.5' },
  { bps: 100, text: '1' },
  { bps: 2050, text: '20.5' },
  { bps: 10000, text: '100' },
])('formats the maximum percent for $bps bps as $text', ({ bps, text }) => {
  expect(selfApprovalNoticeParameters({ ...base, maxEffectiveBps: bps })[6]).toEqual({
    name: 'max_percent',
    type: 'text',
    value: text,
  });
});

it.each([0, -1, 10001, 1.5, Number.NaN])(
  'rejects parameter bps %s with the self-approval error',
  (bps) => {
    expect(() => selfApprovalNoticeParameters({ ...base, maxEffectiveBps: bps })).toThrowError(
      invalidEvent,
    );
  },
);

it.each([1, 20])('accepts an event containing %s proposals', (count) => {
  expect(assertDiscountSelfApprovalEventValues(makeProposals(count))).toBeUndefined();
});

it.each([0, 21])('rejects an event containing %s proposals', (count) => {
  expect(() => assertDiscountSelfApprovalEventValues(makeProposals(count))).toThrowError(
    invalidEvent,
  );
});

it('rejects duplicate proposal ids', () => {
  const proposals = [proposal('duplicate', 100), proposal('duplicate', 200)];
  expect(() => assertDiscountSelfApprovalEventValues(proposals)).toThrowError(invalidEvent);
});

it.each([0, -1, 10001, 1.5, Number.NaN])('rejects a proposal with bps %s', (bps) => {
  expect(() => assertDiscountSelfApprovalEventValues([proposal('proposal-1', bps)])).toThrowError(
    invalidEvent,
  );
});

it.each([
  { proposals: [proposal('a', 100)], expected: 100 },
  {
    proposals: [proposal('a', 100), proposal('b', 900), proposal('c', 500)],
    expected: 900,
  },
  {
    proposals: [proposal('a', 500), proposal('b', 900), proposal('c', 100)],
    expected: 900,
  },
  {
    proposals: [proposal('a', 500), proposal('b', 500), proposal('c', 100)],
    expected: 500,
  },
])('returns the largest effective bps regardless of order or ties', ({ proposals, expected }) => {
  expect(maxSelfApprovalEffectiveBps(proposals)).toBe(expected);
});

it.each([
  { count: 0, lengths: [] },
  { count: 1, lengths: [1] },
  { count: 100, lengths: [100] },
  { count: 101, lengths: [100, 1] },
])('sorts $count recipients into chunks of at most 100', ({ count, lengths }) => {
  const users = makeUserIds(count);
  const result = discountSelfApprovalRecipientGroups([...users].reverse());
  expect(result.recipientCount).toBe(count);
  expect(result.groups.map((group) => group.length)).toEqual(lengths);
  expect(result.groups.flat()).toEqual(users);
});

it('deduplicates and sorts recipients without mutating the input', () => {
  const users = ['user-c', 'user-a', 'user-c', 'user-b', 'user-a'];
  const result = discountSelfApprovalRecipientGroups(users);
  expect(result).toEqual({ groups: [['user-a', 'user-b', 'user-c']], recipientCount: 3 });
  expect(users).toEqual(['user-c', 'user-a', 'user-c', 'user-b', 'user-a']);
});

it('keeps the approving user in the recipient groups', () => {
  expect(discountSelfApprovalRecipientGroups(['owner', 'approver', 'approver'])).toEqual({
    groups: [['approver', 'owner']],
    recipientCount: 2,
  });
});
