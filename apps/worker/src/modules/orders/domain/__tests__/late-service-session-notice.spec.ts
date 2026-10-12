import { expect, it } from 'vitest';
import {
  interimLateNoticeRule,
  qualifiesForLateNotice,
  lateNoticeRecipientGroups,
  lateNoticeParameters,
} from '../late-service-session-notice.ts';

it('SS-Q11 uses only the four manager roles and IN_APP, based on saved facts', () => {
  expect(interimLateNoticeRule()).toEqual({
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  });
  expect(qualifiesForLateNotice({ late: false, lines: [{ late: false }] })).toBe(false);
  expect(qualifiesForLateNotice({ late: true, lines: [{ late: false }] })).toBe(true);
  expect(qualifiesForLateNotice({ late: false, lines: [{ late: true }] })).toBe(true);
});
it.each([0, 1, 100, 101, 201])('stable groups cover %s users exactly once', (n) => {
  const users = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0'));
  const { groups, recipientCount } = lateNoticeRecipientGroups([...users].reverse().concat(users));
  expect(recipientCount).toBe(n);
  expect(groups.flat()).toEqual(users);
  expect(groups.map((g) => g.length)).toEqual(
    n === 201 ? [100, 100, 1] : n === 101 ? [100, 1] : n === 0 ? [] : [n],
  );
});
it.each([
  '+999999998123',
  '٩٩٩ ٩٩٩ ٩٩٨ ١٢٣',
  'example.test',
  'https://example.test',
  'OTP',
  '1234',
])('unsafe name %s falls back without leaking', (name) => {
  const result = lateNoticeParameters({ nameAr: name, nameEn: 'Synthetic branch' }, '2026-10-14', {
    ar: 'فرع',
    en: 'Branch',
  });
  expect(result.map((p) => p.value)).toEqual([
    'Synthetic branch',
    'Synthetic branch',
    '2026-10-14',
  ]);
  expect(
    lateNoticeParameters({ nameAr: null, nameEn: name }, '2026-10-14', {
      ar: 'فرع',
      en: 'Branch',
    }).map((p) => p.value),
  ).toEqual(['فرع', 'Branch', '2026-10-14']);
});
it('year inside a name is allowed; date validates the actual calendar, separate from names', () => {
  expect(
    lateNoticeParameters({ nameAr: 'فرع 2026', nameEn: 'Branch 2026' }, '2024-02-29', {
      ar: 'فرع',
      en: 'Branch',
    })[0].value,
  ).toBe('فرع 2026');
  for (const day of ['2026-02-29', '2026-04-31', '2026-13-01', 'code', '2026-1-01'])
    expect(() =>
      lateNoticeParameters({ nameAr: null, nameEn: 'Branch' }, day, { ar: 'فرع', en: 'Branch' }),
    ).toThrow('LATE_SESSION_DATE_INVALID');
});
