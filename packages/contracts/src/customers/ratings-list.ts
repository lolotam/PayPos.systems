import { z } from 'zod';

import { page } from '../pagination/cursor.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

import { ratingStars } from './ratings.js';

/**
 * فلاتر قائمة التقييمات في الأدمن. `from` شاملة و`to` حصرية على وقت التسجيل `submitted_at`،
 * والنشاط والشركة من المسار والجلسة وليس من الاستعلام، فأي مفتاح غير معروف بيترفض.
 */
export const ratingsListQuery = z
  .strictObject({
    branch_id: id.optional(),
    employee_id: id.optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to),
    {
      message: 'from must be before to',
      path: ['from'],
    },
  );
export type RatingsListQuery = z.infer<typeof ratingsListQuery>;

/**
 * صف تقييم واحد لقارئ التقييمات: النجوم ووقت التسجيل ويوم النشاط والفرع والمنفّذات المسجّلة وقت المطالبة.
 * التعليق نص العميل كما كُتب (RT-Q17) أو null، ولا يخرج لأي قارئ غير حاملي `read:ratings:branch`.
 */
export const ratingsListItem = responseObject({
  id,
  stars: ratingStars,
  submitted_at: timestamp,
  business_date: z.iso.date(),
  branch: responseObject({ id, name_ar: z.string().nullable(), name_en: z.string() }),
  performers: z.array(responseObject({ employee_id: id })),
  comment: z.string().nullable(),
});
export type RatingsListItem = z.infer<typeof ratingsListItem>;

export const ratingsListPage = page(ratingsListItem);
export type RatingsListPage = z.infer<typeof ratingsListPage>;
