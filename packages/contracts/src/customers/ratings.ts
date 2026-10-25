import { z } from 'zod';

import { responseObject } from '../response-object.js';

export const ratingRequestStatus = z
  .enum(['SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'])
  .meta({ id: 'RatingRequestStatus' });
export type RatingRequestStatus = z.infer<typeof ratingRequestStatus>;

// REQUESTS_OFF بييجي مع صف 59-2؛ القيم الحالية مقصودة علشان التوسعة تبقى migration مستقلة.
export const ratingCancelReason = z
  .enum(['NO_ACTIVE_LINE', 'PAST_DEADLINE', 'OPTED_OUT'])
  .meta({ id: 'RatingCancelReason' });
export type RatingCancelReason = z.infer<typeof ratingCancelReason>;

export const ratingStars = z.number().int().min(1).max(5);

// ADR-0011 §4: التعليق من غير روابط ولا صور ولا مرفقات؛ العرض بيتهرب ودي طبقة تانية فوقه.
const LINK_OR_MARKUP_PATTERNS = [
  /https?:\/\//i,
  /\b(?:ftps?|sftp|file):\/\//i,
  /\b(?:mailto|javascript):/i,
  /(?:^|\s)\/\/[a-z0-9]/i,
  /(?:^|[^a-z0-9])www\./i,
  /<\/?[a-z][a-z0-9-]*[\s/>]/i,
  /!\[/,
  /\]\(/,
  // نطاقات الـ TLD مقصودة: لو كانت القاعدة أي word.word كانت هترفض نص عادي زي e.g. أو نقطة ناقصة بعد الكلمة.
  /(?:^|[^a-z0-9])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|edu|gov|io|co|me|app|dev|xyz|online|site|shop|store|link|ly|gl|tv|cc|ws|us|uk|kw|sa|ae|eg|qa|bh|om)(?![a-z0-9])/i,
];

// العد بـ Unicode code points علشان العربي والحروف المركّبة والـ astral ما يتحسبوش بوحدات UTF-16.
// نص عادي: سطر جديد وtabs مسموحين، وباقي الـ control characters مرفوضة (NUL وDEL ونطاق C1) لأن Postgres مش بيقبلها.
export const ratingComment = z
  .string()
  .regex(/^(?:[^\p{Cc}]|[\t\n\r])*(?![\s\S])/u)
  .refine((value) => Array.from(value).length <= 1000, { message: 'At most 1000 characters' })
  .refine((value) => !LINK_OR_MARKUP_PATTERNS.some((pattern) => pattern.test(value)), {
    message: 'Links and markup are not allowed',
  });

export const submitRatingInput = z
  .strictObject({ stars: ratingStars, comment: ratingComment.optional() })
  .meta({ id: 'SubmitRatingInput' });
export type SubmitRatingInput = z.infer<typeof submitRatingInput>;

export const ratingViewState = z.enum(['open', 'submitted']);

// الرد العام كله: أي حقل إضافي هنا يوسّع الإفصاح الممنوع في ADR-0011 §4.
// الطول بالـ code points زي قيد قاعدة البيانات، مش بوحدات UTF-16.
export const ratingView = responseObject({
  business_name: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= 255, { message: 'At most 255 characters' }),
  state: ratingViewState,
}).meta({ id: 'RatingView' });
export type RatingView = z.infer<typeof ratingView>;

/** سبعة أيام من لحظة المطالبة، وهي نفس المدة التي يفرضها قيد قاعدة البيانات. */
export const RATING_TOKEN_LIFETIME_HOURS = 168;
