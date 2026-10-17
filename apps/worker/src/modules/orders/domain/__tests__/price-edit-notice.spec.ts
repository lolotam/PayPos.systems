import { expect, it } from 'vitest';
import {
  interimPriceEditNoticeRule,
  priceEditEditorLabel,
  priceEditNoticeParameters,
  priceEditRecipientGroups,
  type PriceEditParameterInput,
} from '../price-edit-notice.ts';

const fallback: PriceEditParameterInput['fallback'] = {
  service: { ar: 'الخدمة', en: 'Service' },
  branch: { ar: 'فرع', en: 'Branch' },
};
const base = {
  service: { nameAr: 'قص', nameEn: 'Cut' },
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  businessDate: '2026-10-16',
  previousNet: '2.500',
  newNet: '1250.000',
  editor: { ar: 'سالم', en: 'Salem' },
  fallback,
} satisfies PriceEditParameterInput;

it('ED-Q10 keeps the four manager roles and does not name an editor exclusion', () => {
  expect(interimPriceEditNoticeRule()).toEqual({
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  });
});
it.each([0, 1, 100, 101, 201])('stable groups cover %s users exactly once', (n) => {
  const users = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0'));
  const { groups, recipientCount } = priceEditRecipientGroups([...users].reverse().concat(users));
  expect(recipientCount).toBe(n);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    n === 201 ? [100, 100, 1] : n === 101 ? [100, 1] : n === 0 ? [] : [n],
  );
});
it('passes canonical money through and rejects a short, phone-like or URL amount', () => {
  expect(priceEditNoticeParameters(base).map((item) => item.value)).toEqual([
    'قص',
    'Cut',
    'فرع سالم',
    'Salem',
    '2026-10-16',
    '2.500',
    '1250.000',
    'سالم',
    'Salem',
  ]);
  for (const amount of ['2.5', '2.50', '+96512345678', 'https://example.test', '1250'])
    expect(() => priceEditNoticeParameters({ ...base, previousNet: amount })).toThrow(
      'PRICE_EDIT_EVENT_INVALID',
    );
});
it.each(['2026-02-29', '2026-04-31', '2026-13-01', 'code', '2026-1-01'])(
  'rejects calendar date %s',
  (businessDate) => {
    expect(() => priceEditNoticeParameters({ ...base, businessDate })).toThrow(
      'PRICE_EDIT_EVENT_INVALID',
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
  const values = priceEditNoticeParameters({
    ...base,
    service: { nameAr: name, nameEn: 'Cut' },
    branch: { nameAr: null, nameEn: name },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['Cut', 'Cut', 'فرع', 'Branch']);
});
it('editor English does not fall back to Arabic; a missing name uses the stored role', () => {
  expect(names({ nameAr: 'سالم', nameEn: null, role: 'branch_manager' })).toEqual(['سالم', 'Manager']);
  expect(names({ nameAr: null, nameEn: 'Salem', role: 'owner' })).toEqual(['Salem', 'Salem']);
  expect(names({ nameAr: null, nameEn: null, role: 'owner' })).toEqual(['المالك', 'Owner']);
  expect(names({ nameAr: null, nameEn: 'https://x.test', role: 'branch_manager' })).toEqual([
    'المدير',
    'Manager',
  ]);
  expect(names({ nameAr: 'https://x.test', nameEn: 'Salem', role: 'owner' })).toEqual([
    'Salem',
    'Salem',
  ]);
  expect(names({ nameAr: null, nameEn: 'https://x.test', role: null })).toEqual(['موظف', 'Employee']);
  expect(() => names({ nameAr: null, nameEn: null, role: null })).toThrow('PRICE_EDIT_EVENT_INVALID');
  expect(names({ nameAr: '   ', nameEn: null, role: 'cashier' })).toEqual(['كاشير', 'Cashier']);
});
it('keeps a year inside a name and a real leap day', () => {
  const values = priceEditNoticeParameters({
    ...base,
    service: { nameAr: 'خدمة 2026', nameEn: 'Service 2026' },
    businessDate: '2024-02-29',
  }).map((item) => item.value);
  expect(values[0]).toBe('خدمة 2026');
  expect(values[4]).toBe('2024-02-29');
});
function names(editor: Pick<Parameters<typeof priceEditEditorLabel>[0], 'nameAr' | 'nameEn' | 'role'>) {
  const label = priceEditEditorLabel({
    roleIsSystem: editor.role === null ? null : true,
    roleNameAr: null,
    roleNameEn: editor.role === null ? null : 'Synthetic role',
    ...editor,
  });
  return [label.ar, label.en];
}
