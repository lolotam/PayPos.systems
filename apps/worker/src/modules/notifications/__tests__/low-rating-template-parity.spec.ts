import { inAppRecipient } from '@pospay/contracts';
import { validLowRatingTemplate } from '@pospay/notifications';
import { expect, it } from 'vitest';

const USER = '01920000-0000-7000-8000-0000000000f1';
const EMOJI = '\u{1F600}';
type Key = 'low_rating' | 'low_rating_with_comment';

const details = {
  stars: 1,
  branch_name_ar: 'السالمية',
  branch_name_en: 'Salmiya',
  business_date: '2026-11-07',
  performers: [{ name_ar: 'ليلى', name_en: 'Laila' }],
  customer_name: null,
  phone_last3: '07',
};
const commented = { ...details, comment: 'كويس بس متأخر' };
const one = (value: unknown) => [{ name: 'details', type: 'details', value }];

// كل عينة بنتيجتها المتوقعة، عشان التطابق ما يتحققش لو الاتنين رفضوا كل حاجة.
const samples: readonly [string, Key, unknown, boolean][] = [
  ['valid low_rating', 'low_rating', one(details), true],
  ['valid with comment', 'low_rating_with_comment', one(commented), true],
  ['empty comment', 'low_rating_with_comment', one({ ...details, comment: '' }), true],
  ['comment in low_rating', 'low_rating', one(commented), false],
  ['missing comment', 'low_rating_with_comment', one(details), false],
  ['null comment', 'low_rating_with_comment', one({ ...details, comment: null }), false],
  ['extra details key', 'low_rating', one({ ...details, rating_id: USER }), false],
  [
    'extra performer key',
    'low_rating',
    one({ ...details, performers: [{ name_ar: null, name_en: 'Mona', id: 1 }] }),
    false,
  ],
  [
    'extra parameter key',
    'low_rating',
    [{ name: 'details', type: 'details', value: details, x: 1 }],
    false,
  ],
  ['two parameters', 'low_rating', [...one(details), ...one(details)], false],
  ['no parameters', 'low_rating', [], false],
  ['text type', 'low_rating', [{ name: 'details', type: 'text', value: details }], false],
  ['stars 3', 'low_rating', one({ ...details, stars: 3 }), false],
  ['stars text', 'low_rating', one({ ...details, stars: '1' }), false],
  ['impossible date', 'low_rating', one({ ...details, business_date: '2026-02-30' }), false],
  ['leap day', 'low_rating', one({ ...details, business_date: '2028-02-29' }), true],
  ['255 emoji branch', 'low_rating', one({ ...details, branch_name_en: EMOJI.repeat(255) }), true],
  ['256 emoji branch', 'low_rating', one({ ...details, branch_name_en: EMOJI.repeat(256) }), false],
  [
    '201 emoji customer',
    'low_rating',
    one({ ...details, customer_name: EMOJI.repeat(201) }),
    false,
  ],
  ['bare code name', 'low_rating', one({ ...details, customer_name: '20261107' }), false],
  ['phone name', 'low_rating', one({ ...details, customer_name: '+965 9988 7766' }), false],
  ['year in name', 'low_rating', one({ ...details, customer_name: 'Nora 2026' }), true],
  ['untrimmed name', 'low_rating', one({ ...details, customer_name: 'Nora ' }), false],
  ['four phone digits', 'low_rating', one({ ...details, phone_last3: '1234' }), false],
  [
    '1000 emoji comment',
    'low_rating_with_comment',
    one({ ...details, comment: EMOJI.repeat(1000) }),
    true,
  ],
  [
    '1001 emoji comment',
    'low_rating_with_comment',
    one({ ...details, comment: EMOJI.repeat(1001) }),
    false,
  ],
  [
    'bare domain comment is stored text, so it passes',
    'low_rating_with_comment',
    one({ ...details, comment: 'see example.com' }),
    true,
  ],
  [
    'markup comment is stored text, so it passes',
    'low_rating_with_comment',
    one({ ...details, comment: '<b>bad</b>' }),
    true,
  ],
  [
    'markdown link comment is stored text, so it passes',
    'low_rating_with_comment',
    one({ ...details, comment: '[x](y)' }),
    true,
  ],
  [
    'control character comment is stored text, so it passes',
    'low_rating_with_comment',
    one({ ...details, comment: 'a\u0007b' }),
    true,
  ],
  [
    '1001 ascii comment',
    'low_rating_with_comment',
    one({ ...details, comment: 'a'.repeat(1001) }),
    false,
  ],
  ['non-string comment', 'low_rating_with_comment', one({ ...details, comment: 12345 }), false],
  [
    'sentence break comment',
    'low_rating_with_comment',
    one({ ...details, comment: 'Great.It was fine\tthanks' }),
    true,
  ],
  [
    'digits in comment',
    'low_rating_with_comment',
    one({ ...details, comment: 'اتصلوا بيا 99887766' }),
    true,
  ],
];
// كل نمط رابط كان مرفوضًا بقاعدة الإرسال بقى مقبولًا هنا: التعليق المخزّن مش بيتفلتر في الجرس، والاتنين لازم يتفقوا.
const linkComments: readonly [string, boolean][] = [
  ['open https://x.test now', true],
  ['mailto:a@b', true],
  ['go to www.salon', true],
  ['see //host.test', true],
  ['![img]', true],
  ['10.0.0.1/admin', true],
  ['visit salon.shop', true],
  ['write me@salon.local', true],
  ['ftp://files', true],
  ['ok It.Is fine', true],
];
const allSamples = [
  ...samples,
  ...linkComments.map(
    ([comment, expected]) =>
      [comment, 'low_rating_with_comment', one({ ...details, comment }), expected] as const,
  ),
];

it.each(allSamples)(
  'package validator and contract agree: %s',
  (_label, key, parameters, expected) => {
    const contract = inAppRecipient.safeParse({
      channel: 'IN_APP',
      user_id: USER,
      locale: 'ar',
      template_revision: 1,
      template_key: key,
      safe_parameters: parameters,
    }).success;
    expect(contract).toBe(expected);
    expect(validLowRatingTemplate(key, 1, 'ar', parameters)).toBe(expected);
  },
);

it('package validator refuses another revision, locale or key the contract also refuses', () => {
  expect(validLowRatingTemplate('low_rating', 2, 'ar', one(details))).toBe(false);
  expect(validLowRatingTemplate('low_rating', 1, 'fr', one(details))).toBe(false);
  expect(validLowRatingTemplate('generic_notice', 1, 'ar', one(details))).toBe(false);
});
