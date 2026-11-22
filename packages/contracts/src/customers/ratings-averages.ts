import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

import { periodInstant, periodIsValid } from './ratings-period.js';

/**
 * فلاتر متوسطات التقييم في الأدمن: نفس فلاتر القائمة بدون المؤشر والحد. `from` شاملة و`to` حصرية على `submitted_at`،
 * ولو الاتنين غايبين الفترة هي الشهر الميلادي الحالي بتوقيت النشاط (D-B12)، ولو واحد منهم موجود الفترة مفتوحة من الناحية التانية.
 */
export const ratingAveragesQuery = z
  .strictObject({
    branch_id: id.optional(),
    employee_id: id.optional(),
    from: periodInstant.optional(),
    to: periodInstant.optional(),
  })
  .refine(periodIsValid, { message: 'from must be before to', path: ['from'] });
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

export const ratingAverages = responseObject({ items: z.array(ratingAverageItem) });
export type RatingAverages = z.infer<typeof ratingAverages>;
