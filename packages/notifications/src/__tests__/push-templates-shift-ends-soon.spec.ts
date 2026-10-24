import { expect, it } from 'vitest';

import {
  renderPushNotice,
  sanitizePushParameters,
  validPushTemplate,
  type SafeParameter,
} from '../index.ts';

const KEY = 'shift_ends_soon';
const OLD_KEY = 'shift_not_clocked_in_self';
const AR_BODY = 'دوامك بينتهي الساعة 6:00 م في فرع السالمية.';
const EN_BODY = 'Your shift ends at 6:00 PM at Salmiya.';
const AR_BODY_EN_NAME = 'دوامك بينتهي الساعة 6:00 م في Salmiya.';
const AR_BODY_GENERIC = 'دوامك بينتهي الساعة 6:00 م في الفرع.';
const EN_BODY_GENERIC = 'Your shift ends at 6:00 PM at the branch.';

const parameters = (branchAr = 'فرع السالمية', branchEn = 'Salmiya'): readonly SafeParameter[] => [
  { name: 'shift_end', type: 'text', value: '18:00' },
  { name: 'branch_name_ar', type: 'text', value: branchAr },
  { name: 'branch_name_en', type: 'text', value: branchEn },
];

const oldParameters = (): readonly SafeParameter[] => [
  { name: 'shift_start', type: 'text', value: '10:00' },
  { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
];

it('renders the exact copy in both languages with the branch name', () => {
  const values = parameters();
  expect(renderPushNotice(KEY, 1, 'ar', values)).toEqual({
    title: 'دوامك قرب يخلص',
    body: AR_BODY,
  });
  expect(renderPushNotice(KEY, 1, 'en', values)).toEqual({
    title: 'Shift ending soon',
    body: EN_BODY,
  });
});

it('renders the shift end in a 12-hour clock in both languages', () => {
  const cases: readonly [string, string, string][] = [
    ['00:00', '12:00 ص', '12:00 AM'],
    ['00:05', '12:05 ص', '12:05 AM'],
    ['09:05', '9:05 ص', '9:05 AM'],
    ['12:00', '12:00 م', '12:00 PM'],
    ['12:30', '12:30 م', '12:30 PM'],
    ['18:00', '6:00 م', '6:00 PM'],
    ['23:59', '11:59 م', '11:59 PM'],
  ];
  for (const [time, arabic, english] of cases) {
    const values: SafeParameter[] = [
      { name: 'shift_end', type: 'text', value: time },
      ...parameters().slice(1),
    ];
    expect(renderPushNotice(KEY, 1, 'ar', values)?.body).toBe(
      `دوامك بينتهي الساعة ${arabic} في فرع السالمية.`,
    );
    expect(renderPushNotice(KEY, 1, 'en', values)?.body).toBe(
      `Your shift ends at ${english} at Salmiya.`,
    );
  }
});

it('keeps the shift end stored in the 24-hour form', () => {
  const sanitized = sanitizePushParameters(KEY, 1, parameters());
  const stored = sanitized?.find((parameter) => parameter.name === 'shift_end');
  expect(stored?.value).toBe('18:00');
});

it('falls back to the other language when the name of the notice language is missing', () => {
  const values = parameters('', 'Salmiya');
  expect(validPushTemplate(KEY, 1, values)).toBe(true);
  expect(renderPushNotice(KEY, 1, 'ar', values)?.body).toBe(AR_BODY_EN_NAME);
  expect(renderPushNotice(KEY, 1, 'en', values)?.body).toBe(EN_BODY);
});

it('uses the generic branch label when both names are missing', () => {
  const values = parameters('', '');
  expect(validPushTemplate(KEY, 1, values)).toBe(true);
  expect(renderPushNotice(KEY, 1, 'ar', values)?.body).toBe(AR_BODY_GENERIC);
  expect(renderPushNotice(KEY, 1, 'en', values)?.body).toBe(EN_BODY_GENERIC);
});

it('falls back to the other language when a branch name is rejected', () => {
  for (const value of [
    'https://example.test',
    'www.example.test',
    '+96500000001',
    '123456',
    'bearer secret',
  ]) {
    const values = parameters(value, 'Salmiya');
    expect(validPushTemplate(KEY, 1, values)).toBe(true);
    for (const locale of ['ar', 'en'] as const) {
      const body = renderPushNotice(KEY, 1, locale, values)?.body ?? '';
      expect(body).not.toContain(value);
      expect(body).toContain('Salmiya');
    }
  }
  const both = parameters('https://example.test', '123456');
  expect(validPushTemplate(KEY, 1, both)).toBe(true);
  expect(renderPushNotice(KEY, 1, 'ar', both)?.body).toBe(AR_BODY_GENERIC);
  expect(renderPushNotice(KEY, 1, 'en', both)?.body).toBe(EN_BODY_GENERIC);
});

it('takes only a 24-hour shift end', () => {
  for (const value of [
    '24:00',
    '9:00',
    '18:60',
    '',
    '18:00:00',
    'tonight',
    '18:00\n',
    ' 18:00',
    '18:00 ',
    '١٨:٠٠',
  ]) {
    const values: SafeParameter[] = [
      { name: 'shift_end', type: 'text', value },
      ...parameters().slice(1),
    ];
    expect(validPushTemplate(KEY, 1, values)).toBe(false);
    expect(renderPushNotice(KEY, 1, 'ar', values)).toBeNull();
    expect(sanitizePushParameters(KEY, 1, values)).toBeNull();
  }
  for (const value of ['00:00', '09:05', '23:59']) {
    const values: SafeParameter[] = [
      { name: 'shift_end', type: 'text', value },
      ...parameters().slice(1),
    ];
    expect(validPushTemplate(KEY, 1, values)).toBe(true);
    expect(renderPushNotice(KEY, 1, 'ar', values)).not.toBeNull();
    expect(sanitizePushParameters(KEY, 1, values)).not.toBeNull();
  }
});

it('refuses parameters in the wrong order', () => {
  const values: SafeParameter[] = [
    { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'shift_end', type: 'text', value: '18:00' },
  ];
  expect(validPushTemplate(KEY, 1, values)).toBe(false);
  expect(renderPushNotice(KEY, 1, 'ar', values)).toBeNull();
});

it('refuses a wrong revision, an unknown key and an extra parameter', () => {
  const values = parameters();
  const extra: SafeParameter[] = [...values, { name: 'extra', type: 'text', value: 'x' }];
  expect(validPushTemplate('unknown_notice', 1, values)).toBe(false);
  expect(renderPushNotice('unknown_notice', 1, 'ar', values)).toBeNull();
  expect(validPushTemplate(KEY, 2, values)).toBe(false);
  expect(renderPushNotice(KEY, 2, 'ar', values)).toBeNull();
  expect(validPushTemplate(KEY, 1, extra)).toBe(false);
  expect(renderPushNotice(KEY, 1, 'ar', extra)).toBeNull();
  expect(validPushTemplate(KEY, 1, values.slice(0, 2))).toBe(false);
  expect(renderPushNotice(KEY, 1, 'ar', values.slice(0, 2))).toBeNull();
});

it('sanitises the unusable branch names before they are stored', () => {
  const values = parameters();
  expect(sanitizePushParameters(KEY, 1, values)).toEqual(values);
  for (const value of ['https://example.test', '+96500000001', '123456']) {
    const sanitized = sanitizePushParameters(KEY, 1, parameters(value, 'Salmiya'));
    expect(sanitized?.map((parameter) => [parameter.name, parameter.value])).toEqual([
      ['shift_end', '18:00'],
      ['branch_name_ar', ''],
      ['branch_name_en', 'Salmiya'],
    ]);
  }
  expect(sanitizePushParameters('unknown_notice', 1, values)).toBeNull();
  expect(sanitizePushParameters(KEY, 2, values)).toBeNull();
});

it('leaves the older template rendering exactly as it was', () => {
  const values = oldParameters();
  expect(validPushTemplate(OLD_KEY, 1, values)).toBe(true);
  expect(renderPushNotice(OLD_KEY, 1, 'ar', values)?.body).toBe(
    'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في فرع السالمية.',
  );
  expect(renderPushNotice(OLD_KEY, 1, 'en', values)?.body).toBe(
    'No clock-in yet for your 10:00 shift at Salmiya.',
  );
});
