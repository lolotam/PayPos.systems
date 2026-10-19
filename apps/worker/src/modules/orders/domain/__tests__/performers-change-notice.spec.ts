import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import {
  assertPerformersChangeEventValues,
  interimPerformersChangeNoticeRule,
  performersChangeMatchesHistory,
  performersChangeNoticeParameters,
  performersChangeRecipientGroups,
  type PerformerShare,
  type PerformersChangeHistory,
  type PerformersChangeParameterInput,
} from '../performers-change-notice.ts';

const fallback: PerformersChangeParameterInput['fallback'] = {
  service: { ar: 'الخدمة', en: 'Service' },
  branch: { ar: 'فرع', en: 'Branch' },
  safeName: safeDisplayName,
};
const base = {
  service: { nameAr: 'قص', nameEn: 'Cut' },
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  businessDate: '2026-10-16',
  lineNet: '1.000',
  fallback,
} satisfies PerformersChangeParameterInput;
const share = (employee_id: string, share_bps = 10000): PerformerShare => ({
  employee_id,
  share_bps,
});
const history: PerformersChangeHistory = {
  previousRevision: 1,
  before: [share('before')],
  after: [share('after-a'), share('after-b', 4000)],
};
const event = {
  previousRevision: 1,
  previousPerformers: history.before,
  performers: history.after,
};

it('keeps the four manager roles and does not exclude the changer', () => {
  expect(interimPerformersChangeNoticeRule()).toEqual({
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  });
});
it.each([0, 1, 100, 101, 201])('stable groups cover %s users exactly once', (n) => {
  const users = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0'));
  const { groups, recipientCount } = performersChangeRecipientGroups(
    [...users].reverse().concat(users),
  );
  expect(recipientCount).toBe(n);
  expect(groups.flat()).toEqual(users);
  expect(groups.every((group) => group.length <= 100)).toBe(true);
  expect(groups.map((group) => group.length)).toEqual(
    n === 201 ? [100, 100, 1] : n === 101 ? [100, 1] : n === 0 ? [] : [n],
  );
});
it('passes canonical money in template order and rejects a short, phone-like or URL amount', () => {
  expect(performersChangeNoticeParameters(base).map((item) => item.name)).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'line_net',
  ]);
  expect(performersChangeNoticeParameters(base).map((item) => item.value)).toEqual([
    'قص',
    'Cut',
    'فرع سالم',
    'Salem',
    '2026-10-16',
    '1.000',
  ]);
  for (const amount of ['2.5', '2.50', '+96512345678', 'https://example.test', '1250'])
    expect(() => performersChangeNoticeParameters({ ...base, lineNet: amount })).toThrow(
      'LINE_PERFORMERS_EVENT_INVALID',
    );
});
it.each(['2026-02-29', '2026-04-31', '2026-13-01', 'code', '2026-1-01'])(
  'rejects calendar date %s',
  (businessDate) => {
    expect(() => performersChangeNoticeParameters({ ...base, businessDate })).toThrow(
      'LINE_PERFORMERS_EVENT_INVALID',
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
  const values = performersChangeNoticeParameters({
    ...base,
    service: { nameAr: name, nameEn: 'Cut' },
    branch: { nameAr: null, nameEn: name },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['Cut', 'Cut', 'فرع', 'Branch']);
});
it('English does not fall back to Arabic', () => {
  const values = performersChangeNoticeParameters({
    ...base,
    service: { nameAr: 'قص', nameEn: null },
    branch: { nameAr: null, nameEn: 'Salem' },
  }).map((item) => item.value);
  expect(values.slice(0, 4)).toEqual(['قص', 'Service', 'Salem', 'Salem']);
});
it('keeps a year inside a name and a real leap day', () => {
  const values = performersChangeNoticeParameters({
    ...base,
    service: { nameAr: 'خدمة 2026', nameEn: 'Service 2026' },
    businessDate: '2024-02-29',
  }).map((item) => item.value);
  expect(values[0]).toBe('خدمة 2026');
  expect(values[4]).toBe('2024-02-29');
});
it('rejects a non-canonical net before any ledger claim', () => {
  expect(() => assertPerformersChangeEventValues({ businessDate: '2026-10-16', lineNet: '1' })).toThrow(
    'LINE_PERFORMERS_EVENT_INVALID',
  );
});
it('matches a header whose before and after rows equal the event in order', () => {
  expect(performersChangeMatchesHistory(history, event)).toBe(true);
});
it('rejects a missing header, a different previous revision, or a different before row', () => {
  expect(performersChangeMatchesHistory(null, event)).toBe(false);
  expect(performersChangeMatchesHistory({ ...history, previousRevision: 4 }, event)).toBe(false);
  expect(
    performersChangeMatchesHistory({ ...history, before: [share('other')] }, event),
  ).toBe(false);
});
it('rejects an after side that differs in employee, share, order or count', () => {
  expect(
    performersChangeMatchesHistory({ ...history, after: [share('other'), share('after-b', 4000)] }, event),
  ).toBe(false);
  expect(
    performersChangeMatchesHistory(
      { ...history, after: [share('after-a', 1000), share('after-b', 4000)] },
      event,
    ),
  ).toBe(false);
  expect(
    performersChangeMatchesHistory(
      { ...history, after: [share('after-b', 4000), share('after-a')] },
      event,
    ),
  ).toBe(false);
  expect(performersChangeMatchesHistory({ ...history, after: [share('after-a')] }, event)).toBe(
    false,
  );
});
