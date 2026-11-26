import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  assertPackageRefundEventValues,
  packageRefundNoticeParameters,
  packageRefundRecipientGroups,
  type PackageRefundParameterInput,
} from '../package-refund-notice.ts';

const fallback: PackageRefundParameterInput['fallback'] = {
  packageName: { ar: 'الباقة', en: 'Package' },
  branch: { ar: 'فرع', en: 'Branch' },
  safeName: safeDisplayName,
};
const base = {
  packageName: { nameAr: 'باقة شعر', nameEn: 'Hair package' },
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  sessions: 3,
  amount: '7.500',
  businessDate: '2026-11-20',
  fallback,
} satisfies PackageRefundParameterInput;

it.each([0, 1, 100, 101, 201])('stable groups cover %s users exactly once', (n) => {
  const users = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0'));
  const { groups, recipientCount } = packageRefundRecipientGroups(
    [...users].reverse().concat(users),
  );
  expect(recipientCount).toBe(n);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    n === 201 ? [100, 100, 1] : n === 101 ? [100, 1] : n === 0 ? [] : [n],
  );
});

it('passes the package, the branch, the sessions, the amount and the date in template order', () => {
  expect(packageRefundNoticeParameters(base).map((item) => item.name)).toEqual([
    'package_name_ar',
    'package_name_en',
    'branch_name_ar',
    'branch_name_en',
    'sessions',
    'amount',
    'business_date',
  ]);
  expect(packageRefundNoticeParameters(base).map((item) => item.value)).toEqual([
    'باقة شعر',
    'Hair package',
    'فرع سالم',
    'Salem',
    '3',
    '7.500',
    '2026-11-20',
  ]);
});

it('falls back to the catalogue label and never translates the English name back', () => {
  const values = packageRefundNoticeParameters({
    ...base,
    packageName: { nameAr: null, nameEn: 'Hair package' },
    branch: { nameAr: null, nameEn: 'Salem' },
  });
  expect(values[0]?.value).toBe('Hair package');
  expect(values[1]?.value).toBe('Hair package');
  expect(values[2]?.value).toBe('Salem');
  expect(values[3]?.value).toBe('Salem');
  const empty = packageRefundNoticeParameters({
    ...base,
    packageName: { nameAr: null, nameEn: null },
    branch: { nameAr: null, nameEn: null },
  });
  expect(empty[0]?.value).toBe('الباقة');
  expect(empty[2]?.value).toBe('فرع');
});

it('carries no reason, no customer and no refunder', () => {
  const values = packageRefundNoticeParameters(base);
  expect(values.map((item) => item.name).join(' ')).not.toMatch(/reason|customer|phone|refund/i);
});

it.each(['not-a-date', '2026-02-30', '2026-13-01', '2026-2-1'])(
  'refuses the calendar date %s',
  (businessDate) => {
    expect(() =>
      assertPackageRefundEventValues({ businessDate, amount: '1.000', sessions: 1 }),
    ).toThrow('PACKAGE_REFUND_EVENT_INVALID');
  },
);

it.each(['7.500', '0.000', '1250.000'])('accepts the canonical amount %s', (amount) => {
  expect(() =>
    assertPackageRefundEventValues({ businessDate: '2026-11-20', amount, sessions: 1 }),
  ).not.toThrow();
});

it.each(['7.5', '7,500', 'abc', ''])('refuses the amount %s', (amount) => {
  expect(() =>
    assertPackageRefundEventValues({ businessDate: '2026-11-20', amount, sessions: 1 }),
  ).toThrow('PACKAGE_REFUND_EVENT_INVALID');
});

it.each([0, -1, 366, 1.5])('refuses the session count %s', (sessions) => {
  expect(() =>
    assertPackageRefundEventValues({ businessDate: '2026-11-20', amount: '1.000', sessions }),
  ).toThrow('PACKAGE_REFUND_EVENT_INVALID');
});
