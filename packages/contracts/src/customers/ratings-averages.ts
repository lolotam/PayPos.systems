import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

import {
  monthExcludesRange,
  periodInstant,
  periodIsValid,
  ratingsMonth,
  resolvedRatingsMonth,
} from './ratings-period.js';

export {
  MAX_RATING_AVERAGES_RANGE_DAYS,
  isRatingAveragesRangeWithinMax,
} from './ratings-period.js';

/**
 * فلاتر متوسطات التقييم في الأدمن: نفس فلاتر القائمة بدون المؤشر والحد. `from` شاملة و`to` حصرية على `submitted_at`،
 * ولو الاتنين غايبين الفترة هي الشهر الميلادي الحالي بتوقيت النشاط (D-B12)، والمخطط بيقبل طرف واحد أو طرفين لفحص
 * الصياغة بس بينما القراءة بترفض الطرف الواحد أو الأوسع من 366 يوم بـ 422. `month` (`YYYY-MM`) بديل عن الاتنين: الشهر
 * الميلادي ده بتوقيت النشاط، ومش بيتجمع مع `from`/`to` (D-B12).
 *
 * القراءة نفسها (`readRatingAverages`) بتقبل غياب الطرفين (الشهر الحالي) أو فترة مغلقة من طرفين عرضها 366 يوم
 * على الأكثر (PP-278)، واللي يتعدى الحد أو يبقى من طرف واحد بيرجع 422 `RATING_RANGE_TOO_WIDE`. القاعدة دي مش
 * `.refine()` هنا على المخطط: فشل التحقق بيرجع 400 `VALIDATION_FAILED`، والحد ده محتاج 422، فبيتحرس في طبقة
 * القراءة مش في المخطط.
 */
export const ratingAveragesQuery = z
  .strictObject({
    branch_id: id.optional(),
    employee_id: id.optional(),
    from: periodInstant.optional(),
    to: periodInstant.optional(),
    month: ratingsMonth.optional(),
  })
  .refine(periodIsValid, { message: 'from must be before to', path: ['from'] })
  .refine(monthExcludesRange, {
    message: 'month cannot be combined with from or to',
    path: ['month'],
  });
export type RatingAveragesQuery = z.infer<typeof ratingAveragesQuery>;

/**
 * متوسط موظفة واحدة على التقييمات المنسوبة لها في الفترة: نص بخانة عشرية واحدة مقرّبة لأعلى عند المنتصف (`"4.5"`)،
 * وعدد تقييماتها. التقييم بمنفّذتين بيدخل في متوسط الاتنتين (RT-24). الموظفة بلا تقييمات في الفترة مش بتظهر.
 */
export const ratingAverageItem = responseObject({
  employee_id: id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  average: z.string().regex(/^(?:[1-4]\.[0-9]|5\.0)$/),
  count: z.number().int().positive(),
});
export type RatingAverageItem = z.infer<typeof ratingAverageItem>;

/** متوسطات الموظفات؛ `month` هو شهر الفترة بتوقيت النشاط (من `month` أو الافتراضي)، وnull لما اتبعت `from`/`to`. */
export const ratingAverages = responseObject({
  items: z.array(ratingAverageItem),
  month: resolvedRatingsMonth,
});
export type RatingAverages = z.infer<typeof ratingAverages>;
