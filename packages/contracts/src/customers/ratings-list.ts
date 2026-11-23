import { z } from 'zod';

import { page } from '../pagination/cursor.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

import {
  monthExcludesRange,
  periodInstant,
  periodIsValid,
  ratingsMonth,
  resolvedRatingsMonth,
} from './ratings-period.js';
import { ratingStars } from './ratings.js';

/**
 * فلاتر قائمة التقييمات في الأدمن. `from` شاملة و`to` حصرية على وقت التسجيل `submitted_at`،
 * و`month` (`YYYY-MM`) بديلهم: السيرفر يحوّله لنافذة الشهر الميلادي بتوقيت النشاط، ومش بيتجمع مع `from`/`to`.
 * والنشاط والشركة من المسار والجلسة وليس من الاستعلام، فأي مفتاح غير معروف بيترفض.
 */
export const ratingsListQuery = z
  .strictObject({
    branch_id: id.optional(),
    employee_id: id.optional(),
    from: periodInstant.optional(),
    to: periodInstant.optional(),
    month: ratingsMonth.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(periodIsValid, { message: 'from must be before to', path: ['from'] })
  .refine(monthExcludesRange, {
    message: 'month cannot be combined with from or to',
    path: ['month'],
  });
export type RatingsListQuery = z.infer<typeof ratingsListQuery>;

/**
 * صف تقييم واحد لقارئ التقييمات: النجوم ووقت التسجيل ويوم النشاط والفرع والمنفّذات المسجّلة وقت المطالبة باسميهم.
 * التعليق نص العميل كما كُتب (RT-Q17) أو null، ولا يخرج لأي قارئ غير حاملي `read:ratings:branch`.
 */
export const ratingsListItem = responseObject({
  id,
  stars: ratingStars,
  submitted_at: timestamp,
  business_date: z.iso.date(),
  branch: responseObject({ id, name_ar: z.string().nullable(), name_en: z.string() }),
  performers: z.array(
    responseObject({ employee_id: id, name_ar: z.string().nullable(), name_en: z.string() }),
  ),
  comment: z.string().nullable(),
});
export type RatingsListItem = z.infer<typeof ratingsListItem>;

/** صفحة التقييمات؛ `month` هو الشهر الذي حوّل السيرفر `month` إليه (بتوقيت النشاط)، وnull لما `from`/`to` أو بلا فترة. */
export const ratingsListPage = page(ratingsListItem).extend({ month: resolvedRatingsMonth });
export type RatingsListPage = z.infer<typeof ratingsListPage>;

/**
 * محتوى مؤشر القائمة بعد فك ترميزه: وقت تسجيل آخر تقييم في الصفحة ومعرّفه. الوقت بنفس قاعدة حدود الفترة (`periodInstant`)
 * عشان مؤشر محرّف بتاريخ ترفضه PostgreSQL (السنة 0000 مثلًا) يترد 400 مش خطأ cast بـ500.
 */
export const ratingsCursorKey = z.object({ at: periodInstant, id });
export type RatingsCursorKey = z.infer<typeof ratingsCursorKey>;
