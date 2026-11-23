import { expect, it } from 'vitest';

import {
  inAppNotification,
  inAppRecipient,
  lowRatingCommentDetailsV1,
  lowRatingDetailsV1,
  ratingComment,
  readInAppNotificationPage,
} from '../index.js';

const USER = '01920000-0000-7000-8000-0000000000f1';
const ROW = '01920000-0000-7000-8000-0000000000a1';
const EMOJI = '\u{1F600}';

const details = {
  stars: 2,
  branch_name_ar: 'السالمية',
  branch_name_en: 'Salmiya',
  business_date: '2026-11-07',
  performers: [
    { name_ar: 'ليلى', name_en: 'Laila' },
    { name_ar: null, name_en: 'Mona' },
  ],
  customer_name: 'Synthetic customer',
  phone_last3: '123',
};
const withComment = { ...details, comment: 'الخدمة اتأخرت\nوالمكان زحمة' };

function recipient(key: 'low_rating' | 'low_rating_with_comment', value: unknown) {
  return {
    channel: 'IN_APP',
    user_id: USER,
    locale: 'ar',
    template_revision: 1,
    template_key: key,
    safe_parameters: [{ name: 'details', type: 'details', value }],
  };
}

it('accepts both keys with their exact shape and keeps every performer', () => {
  expect(inAppRecipient.parse(recipient('low_rating', details))).toEqual(
    recipient('low_rating', details),
  );
  expect(inAppRecipient.parse(recipient('low_rating_with_comment', withComment))).toEqual(
    recipient('low_rating_with_comment', withComment),
  );
});

it('forbids comment in low_rating and requires it in low_rating_with_comment', () => {
  expect(inAppRecipient.safeParse(recipient('low_rating', withComment)).success).toBe(false);
  expect(inAppRecipient.safeParse(recipient('low_rating_with_comment', details)).success).toBe(
    false,
  );
});

it.each([
  ['an unknown details key', { ...details, branch_id: ROW }],
  [
    'an unknown performer key',
    { ...details, performers: [{ name_ar: 'ليلى', name_en: 'Laila', id: ROW }] },
  ],
  ['stars 3', { ...details, stars: 3 }],
  ['stars 0', { ...details, stars: 0 }],
  ['stars as text', { ...details, stars: '2' }],
  ['an impossible date', { ...details, business_date: '2026-02-30' }],
  ['four phone digits', { ...details, phone_last3: '1234' }],
  ['one phone digit', { ...details, phone_last3: '1' }],
  ['an untrimmed name', { ...details, branch_name_en: ' Salmiya' }],
  ['an empty name', { ...details, customer_name: '' }],
])('rejects %s', (_label, value) => {
  expect(lowRatingDetailsV1.safeParse(value).success).toBe(false);
});

it('rejects a second parameter and an extra key on the parameter', () => {
  const extra = recipient('low_rating', details);
  const two = { ...extra, safe_parameters: [...extra.safe_parameters, ...extra.safe_parameters] };
  const keyed = { ...extra, safe_parameters: [{ ...extra.safe_parameters[0], label: 'x' }] };
  expect(inAppRecipient.safeParse(two).success).toBe(false);
  expect(inAppRecipient.safeParse(keyed).success).toBe(false);
});

it('counts names in code points: 255 emoji fit a branch, 200 fit a customer, one more does not', () => {
  const accepts = (patch: object) => lowRatingDetailsV1.safeParse({ ...details, ...patch }).success;
  expect(accepts({ branch_name_ar: EMOJI.repeat(255), phone_last3: '12' })).toBe(true);
  expect(accepts({ branch_name_ar: EMOJI.repeat(256) })).toBe(false);
  expect(accepts({ customer_name: EMOJI.repeat(200) })).toBe(true);
  expect(accepts({ customer_name: EMOJI.repeat(201) })).toBe(false);
  expect(accepts({ customer_name: null, branch_name_ar: null, performers: [] })).toBe(true);
});

it('rejects a bare code or a phone as a name and keeps a year inside a name', () => {
  const accepts = (name: string) =>
    lowRatingDetailsV1.safeParse({ ...details, performers: [{ name_ar: null, name_en: name }] })
      .success;
  expect(accepts('12345')).toBe(false);
  expect(accepts('Call 99887766')).toBe(false);
  expect(accepts('salon.com')).toBe(false);
  expect(accepts('Salon 2026')).toBe(true);
});

it('takes a stored comment of any content up to 1000 code points and refuses 1001', () => {
  const accepts = (comment: string) =>
    lowRatingCommentDetailsV1.safeParse({ ...details, comment }).success;
  expect(accepts(EMOJI.repeat(1000))).toBe(true);
  expect(accepts(EMOJI.repeat(1001))).toBe(false);
  expect(accepts('a'.repeat(1001))).toBe(false);
  expect(accepts('اتصلوا بيا 99887766')).toBe(true);
  expect(accepts(12345 as unknown as string)).toBe(false);
});

it('does not let the live submission rule decide whether a stored notice reads back', () => {
  // تعليق اتخزن تحت قاعدة أقدم أو أوسع: رابط وmarkup وcontrol character. لازم الجرس يتنشأ، والصف المخزن يتقرا، وصفحة الجرس ما تفشلش.
  const stored = 'see https://example.test <b>x</b> [a](b) salon.com \u0007';
  expect(ratingComment.safeParse(stored).success).toBe(false);
  expect(lowRatingCommentDetailsV1.safeParse({ ...details, comment: stored }).success).toBe(true);
  const row = {
    id: ROW,
    company_id: ROW,
    business_id: ROW,
    branch_id: ROW,
    source_event_id: ROW,
    template_key: 'low_rating_with_comment',
    template_revision: 1,
    locale: 'ar',
    safe_parameters: [{ name: 'details', type: 'details', value: { ...details, comment: stored } }],
    created_at: '2026-11-07T10:00:00.000Z',
    read_at: null,
  };
  const page = readInAppNotificationPage({ items: [row], next_cursor: null });
  expect(page.items).toHaveLength(1);
  expect(
    inAppRecipient.safeParse({
      channel: 'IN_APP',
      user_id: USER,
      locale: 'ar',
      template_revision: 1,
      template_key: 'low_rating_with_comment',
      safe_parameters: row.safe_parameters,
    }).success,
  ).toBe(true);
});

it('returns a stored row of each key in the inbox shape', () => {
  for (const [key, value] of [
    ['low_rating', details],
    ['low_rating_with_comment', withComment],
  ] as const) {
    const row = {
      id: ROW,
      company_id: ROW,
      business_id: ROW,
      branch_id: ROW,
      source_event_id: ROW,
      template_key: key,
      template_revision: 1,
      locale: 'ar',
      safe_parameters: [{ name: 'details', type: 'details', value }],
      created_at: '2026-11-07T10:00:00.000Z',
      read_at: null,
    };
    expect(inAppNotification.parse(row)).toEqual(row);
  }
});
