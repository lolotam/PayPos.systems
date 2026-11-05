import { z } from 'zod';

import { id } from '../scalars/id.js';

/**
 * بيانات مهمة المطالبة: هوية الشركة بس.
 *
 * مفيش مؤشر صفحة ولا معرّف طلب في البيانات، عشان كل دور يقرأ موضعه من حالة Redis
 * بتاعته، والبيانات ما بتتغيرش أثناء الدورات.
 */
export const ratingClaimsJob = z.strictObject({
  companyId: id,
});
export type RatingClaimsJob = z.infer<typeof ratingClaimsJob>;
