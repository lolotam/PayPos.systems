import { describe, expect, it } from 'vitest';

import {
  isLowRating,
  lowRatingDelivery,
  lowRatingDetails,
  noticeComment,
  noticeRecipients,
  ratingMatchesEvent,
  recipientGroups,
  sortedUnique,
  type LowRatingFacts,
} from '../low-rating-notice.ts';
import { phoneLast3 } from '../phone-last3.ts';

const userIds = (count: number, start = 0) =>
  Array.from(
    { length: count },
    (_, i) => `01920000-0000-7000-8000-${String(start + i).padStart(12, '0')}`,
  );
const input = {
  stars: 2 as const,
  branch: { nameAr: 'السالمية', nameEn: 'Salmiya' },
  businessDate: '2026-11-07',
  performers: [{ nameAr: 'ليلى', nameEn: 'Laila' }],
  customer: { name: 'Synthetic customer', phone: '+12025550123' },
};

describe('stars gate and event integrity', () => {
  it.each([
    [1, true],
    [2, true],
    [3, false],
    [5, false],
    [0, false],
  ])('stars %i is low: %s', (stars, low) => {
    expect(isLowRating(stars)).toBe(low);
  });

  it('matches only when request, business, branch and stars all agree', () => {
    const facts: LowRatingFacts = { requestId: 'r', businessId: 'b', branchId: 'c', stars: 2 };
    expect(ratingMatchesEvent(facts, { ...facts })).toBe(true);
    for (const other of [{ requestId: 'x' }, { businessId: 'x' }, { branchId: 'x' }, { stars: 1 }])
      expect(ratingMatchesEvent(facts, { ...facts, ...other })).toBe(false);
  });

  it('a rule that is off or has no channel delivers to nobody', () => {
    const rule = { enabled: true, recipientRoles: ['owner'], channels: ['IN_APP'] } as const;
    const nobody = { active: false, roles: [], channels: [] };
    expect(lowRatingDelivery(rule)).toEqual({ active: true, roles: ['owner'], channels: ['IN_APP'] });
    expect(lowRatingDelivery({ ...rule, enabled: false })).toEqual(nobody);
    expect(lowRatingDelivery({ ...rule, channels: [] })).toEqual(nobody);
  });

  it('an email or WhatsApp only rule stays active with its roles (62b-1)', () => {
    const rule = { enabled: true, recipientRoles: ['owner'], channels: ['EMAIL', 'WHATSAPP'] } as const;
    expect(lowRatingDelivery(rule)).toEqual({
      active: true,
      roles: ['owner'],
      channels: ['EMAIL', 'WHATSAPP'],
    });
  });
});

describe('recipient partition and groups', () => {
  const users = userIds(4);

  it('without a comment every candidate gets low_rating and readers are ignored', () => {
    expect(recipientGroups(users, users, null)).toEqual([
      { template: 'low_rating', userIds: users },
    ]);
  });

  it('readers get the comment template and the rest get the plain one, disjointly', () => {
    const groups = recipientGroups(users, [users[1] ?? '', users[3] ?? ''], 'comment');
    expect(groups).toEqual([
      { template: 'low_rating_with_comment', userIds: [users[1], users[3]], comment: 'comment' },
      { template: 'low_rating', userIds: [users[0], users[2]] },
    ]);
  });

  it('a reader that is not a candidate is never added', () => {
    expect(recipientGroups(users, userIds(1, 99), 'comment')).toEqual([
      { template: 'low_rating', userIds: users },
    ]);
  });

  it('101 recipients in one partition become two groups of 100 and 1, never mixed', () => {
    const many = userIds(101);
    const plain = recipientGroups(many, [], 'comment');
    expect(plain.map((g) => [g.template, g.userIds.length])).toEqual([
      ['low_rating', 100],
      ['low_rating', 1],
    ]);
    const readers = recipientGroups(many, many, 'comment');
    expect(readers.map((g) => [g.template, g.userIds.length])).toEqual([
      ['low_rating_with_comment', 100],
      ['low_rating_with_comment', 1],
    ]);
  });

  it('no candidates yields no group; sortedUnique orders and drops repeats', () => {
    expect(recipientGroups([], [], 'comment')).toEqual([]);
    expect(sortedUnique(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('details composition', () => {
  it('carries the saved facts and only the last digits of the phone', () => {
    const details = lowRatingDetails(input);
    expect(details).toEqual({
      stars: 2,
      branch_name_ar: 'السالمية',
      branch_name_en: 'Salmiya',
      business_date: '2026-11-07',
      performers: [{ name_ar: 'ليلى', name_en: 'Laila' }],
      customer_name: 'Synthetic customer',
      phone_last3: '123',
    });
    expect(JSON.stringify(details)).not.toContain('2025550123');
  });

  it('an unsafe, empty or over-long name becomes null for the renderer', () => {
    const details = lowRatingDetails({
      ...input,
      branch: { nameAr: 'example.com', nameEn: '   ' },
      customer: { name: '12345678', phone: input.customer.phone },
    });
    expect(details).toMatchObject({
      branch_name_ar: null,
      branch_name_en: null,
      customer_name: null,
    });
    const long = 'ا'.repeat(201);
    expect(
      lowRatingDetails({ ...input, customer: { name: long, phone: '+12' } }).customer_name,
    ).toBeNull();
  });

  it('keeps every performer in order, including repeats and unnamed ones', () => {
    const performers = [
      { nameAr: 'ليلى', nameEn: null },
      { nameAr: 'ليلى', nameEn: null },
      { nameAr: null, nameEn: null },
    ];
    expect(lowRatingDetails({ ...input, performers }).performers).toEqual([
      { name_ar: 'ليلى', name_en: null },
      { name_ar: 'ليلى', name_en: null },
      { name_ar: null, name_en: null },
    ]);
  });
});

describe('comment and contract', () => {
  it('the comment is shown as written, even with a phone number inside it (RT-Q17)', () => {
    const written = 'اتصلوا بيا على 99887766';
    expect(noticeComment(written)).toBe(written);
    expect(noticeComment(null)).toBeNull();
    expect(noticeComment('')).toBeNull();
  });

  it('builds recipients with the fixed notice shape, the comment only in its template', () => {
    const details = lowRatingDetails(input);
    const users = userIds(2);
    const [commentGroup, plainGroup] = recipientGroups(users, [users[0] ?? ''], 'كما كُتب');
    if (commentGroup === undefined || plainGroup === undefined) throw new Error('groups');
    const [withComment] = noticeRecipients(commentGroup, details);
    const [plain] = noticeRecipients(plainGroup, details);
    expect(withComment?.safe_parameters[0].value).toHaveProperty('comment', 'كما كُتب');
    expect(plain?.safe_parameters[0].value).not.toHaveProperty('comment');
    expect(
      [withComment, plain].map((r) => [
        r?.channel,
        r?.locale,
        r?.template_key,
        r?.template_revision,
      ]),
    ).toEqual([
      ['IN_APP', 'ar', 'low_rating_with_comment', 1],
      ['IN_APP', 'ar', 'low_rating', 1],
    ]);
  });
});

describe('phoneLast3 keeps the semantics of the API maskPhone', () => {
  // التوقعات هي `maskPhone(phone).slice(3)` في apps/api/.../customers/domain/phone.ts محسوبة يدويًا.
  it.each([
    ['+12', '12'],
    ['+123', '123'],
    ['+1234', '234'],
    ['+12025550123', '123'],
    ['+96512345678', '678'],
    ['+123456789012345', '345'],
  ])('%s -> %s', (phone, expected) => {
    expect(phoneLast3(phone)).toBe(expected);
    expect(`***${phoneLast3(phone)}`).toBe(`***${phone.slice(1).slice(-3)}`);
  });

  it.each(['', '1', '+1', '12025550123', '+0123', '+12a45', '+1234567890123456'])(
    'refuses a value that is not E.164: %j',
    (phone) => {
      expect(() => phoneLast3(phone)).toThrow('LOW_RATING_PHONE_INVALID');
    },
  );
});
