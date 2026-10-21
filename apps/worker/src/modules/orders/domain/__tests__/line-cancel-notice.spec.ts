import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  lineCancelNoticeParameters,
  lineCancelRecipientGroups,
  type LineCancelParameterInput,
} from '../line-cancel-notice.ts';

const fallback: LineCancelParameterInput['fallback'] = {
  service: { ar: 'الخدمة', en: 'Service' },
  branch: { ar: 'فرع', en: 'Branch' },
  safeName: safeDisplayName,
};
const base = {
  service: { nameAr: 'قص', nameEn: 'Cut' },
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  businessDate: '2026-10-16',
  cancelledNet: '1.000',
  fallback,
} satisfies LineCancelParameterInput;

it.each([0, 1, 100, 101, 201])('stable groups cover %s users exactly once', (n) => {
  const users = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0'));
  const { groups, recipientCount } = lineCancelRecipientGroups([...users].reverse().concat(users));
  expect(recipientCount).toBe(n);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    n === 201 ? [100, 100, 1] : n === 101 ? [100, 1] : n === 0 ? [] : [n],
  );
});
it('passes canonical money in template order and rejects a short, phone-like or URL amount', () => {
  expect(lineCancelNoticeParameters(base).map((item) => item.name)).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'cancelled_net',
  ]);
  expect(lineCancelNoticeParameters(base).map((item) => item.value)).toEqual([
    'قص',
    'Cut',
    'فرع سالم',
    'Salem',
    '2026-10-16',
    '1.000',
  ]);
  for (const amount of ['2.5', '2.50', '+96512345678', 'https://example.test', '1250'])
    expect(() => lineCancelNoticeParameters({ ...base, cancelledNet: amount })).toThrow(
      'LINE_CANCEL_EVENT_INVALID',
    );
});
it.each(['2026-02-29', '2026-04-31', '2026-13-01', 'code', '2026-1-01'])(
  'rejects calendar date %s',
  (businessDate) => {
    expect(() => lineCancelNoticeParameters({ ...base, businessDate })).toThrow(
      'LINE_CANCEL_EVENT_INVALID',
    );
  },
);
it.each([
  '+999999998123',
  '٩٩٩ ٩٩٩ ٩٩٨ ١٢٣',
  'example.test',
  'https://example.test',
  'OTP',
  '1234',
])('unsafe name %s uses the injected fallback', (name) => {
  const values = lineCancelNoticeParameters({
    ...base,
    service: { nameAr: name, nameEn: 'Cut' },
    branch: { nameAr: null, nameEn: name },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['Cut', 'Cut', 'فرع', 'Branch']);
});
it('English does not fall back to Arabic', () => {
  const values = lineCancelNoticeParameters({
    ...base,
    service: { nameAr: 'قص', nameEn: null },
    branch: { nameAr: null, nameEn: 'Salem' },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['قص', 'Service', 'Salem', 'Salem']);
});
it('keeps a year inside a name and a real leap day', () => {
  const values = lineCancelNoticeParameters({
    ...base,
    service: { nameAr: 'خدمة 2026', nameEn: 'Service 2026' },
    businessDate: '2024-02-29',
  }).map((item) => item.value);
  expect(values[0]).toBe('خدمة 2026');
  expect(values[4]).toBe('2024-02-29');
});
