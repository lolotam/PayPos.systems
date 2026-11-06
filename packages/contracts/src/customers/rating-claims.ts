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

/** يصدر مرة لكل شركة عند تجهيز اكتشاف طلباتها السابقة؛ هوية الشركة في غلاف الحدث فقط. */
export const RATING_CLAIMS_DISCOVERY = 'RatingClaimsDiscoveryRequested';
/** PP-96: مجرى مستقل حتى لا يوقف الاكتشاف المتعثر أحداث الشركة الأخرى. */
export const RATING_CLAIMS_DISCOVERY_AGGREGATE = 'rating_claims_discovery';
/** الاكتشاف لا يحمل طلبًا أو عميلًا أو رابطًا؛ التسجيل يحتاج هوية الشركة من الغلاف فقط. */
export const ratingClaimsDiscoveryPayload = z.strictObject({});
