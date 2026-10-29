import { z } from 'zod';

import { responseObject } from '../response-object.js';

import { ratingComment } from './rating-comment.js';

export { ratingComment } from './rating-comment.js';

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

/**
 * التوكن بيسافر في الهيدر ده، مش في المسار ولا في الـ query ولا في الـ body (D-B10، ADR-0011 §4):
 * التوكن في المسار بيتسجّل في سجل المتصفح وفي الـ referrer وسجلات الوصول.
 */
export const RATING_TOKEN_HEADER = 'x-rating-token';
