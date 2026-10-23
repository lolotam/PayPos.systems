import { expect, it } from 'vitest';

import { renderPushNotice, validPushTemplate, type SafeParameter } from '../index.ts';

const KEY = 'shift_not_clocked_in_self';

const parameters = (branchAr = 'فرع السالمية', branchEn = 'Salmiya'): readonly SafeParameter[] => [
  { name: 'shift_start', type: 'text', value: '10:00' },
  { name: 'branch_name_ar', type: 'text', value: branchAr },
  { name: 'branch_name_en', type: 'text', value: branchEn },
];

it('renders the exact copy in both languages with the branch name', () => {
  const values = parameters();
  expect(renderPushNotice(KEY, 1, 'ar', values)).toEqual({
    title: 'بصمة الحضور',
    body: 'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في فرع السالمية.',
  });
  expect(renderPushNotice(KEY, 1, 'en', values)).toEqual({
    title: 'Clock-in',
    body: 'No clock-in yet for your 10:00 shift at Salmiya.',
  });
});

it('falls back to the other language when the name of the notice language is missing', () => {
  const values = parameters('', 'Salmiya');
  expect(validPushTemplate(KEY, 1, values)).toBe(true);
  expect(renderPushNotice(KEY, 1, 'ar', values)?.body).toBe(
    'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في Salmiya.',
  );
  expect(renderPushNotice(KEY, 1, 'en', values)?.body).toBe(
    'No clock-in yet for your 10:00 shift at Salmiya.',
  );
});

it('uses the generic branch label when both names are missing', () => {
  const values = parameters('', '');
  expect(validPushTemplate(KEY, 1, values)).toBe(true);
  expect(renderPushNotice(KEY, 1, 'ar', values)?.body).toBe(
    'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في الفرع.',
  );
  expect(renderPushNotice(KEY, 1, 'en', values)?.body).toBe(
    'No clock-in yet for your 10:00 shift at the branch.',
  );
});

it('refuses an unknown template, a wrong revision and a missing parameter', () => {
  const values = parameters();
  expect(validPushTemplate('unknown_notice', 1, values)).toBe(false);
  expect(renderPushNotice('unknown_notice', 1, 'ar', values)).toBeNull();
  expect(validPushTemplate(KEY, 2, values)).toBe(false);
  expect(renderPushNotice(KEY, 2, 'ar', values)).toBeNull();
  expect(validPushTemplate(KEY, 1, values.slice(0, 2))).toBe(false);
  expect(renderPushNotice(KEY, 1, 'ar', values.slice(0, 2))).toBeNull();
  expect(validPushTemplate(KEY, 1, [...values, { name: 'extra', type: 'text', value: 'x' }])).toBe(
    false,
  );
  expect(
    validPushTemplate(KEY, 1, [
      { name: 'shift_start', type: 'text', value: '10:00' },
      { name: 'branch_name', type: 'text', value: 'Salmiya' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    ]),
  ).toBe(false);
});

it('refuses a shift start that carries a link, a phone or a bare code', () => {
  for (const value of ['https://example.test/private', '+96500000001', '123456', 'bearer secret']) {
    const values: SafeParameter[] = [
      { name: 'shift_start', type: 'text', value },
      ...parameters().slice(1),
    ];
    expect(validPushTemplate(KEY, 1, values)).toBe(false);
    expect(renderPushNotice(KEY, 1, 'ar', values)).toBeNull();
  }
});

it('falls back to the other language when a branch name is rejected', () => {
  for (const value of [
    'https://example.test/private',
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
  expect(renderPushNotice(KEY, 1, 'ar', both)?.body).toBe(
    'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في الفرع.',
  );
  expect(renderPushNotice(KEY, 1, 'en', both)?.body).toBe(
    'No clock-in yet for your 10:00 shift at the branch.',
  );
});

it('leaves no placeholder brace in the rendered body', () => {
  for (const locale of ['ar', 'en'] as const) {
    const body = renderPushNotice(KEY, 1, locale, parameters())?.body ?? '';
    expect(body).not.toContain('{');
    expect(body).not.toContain('}');
  }
});
