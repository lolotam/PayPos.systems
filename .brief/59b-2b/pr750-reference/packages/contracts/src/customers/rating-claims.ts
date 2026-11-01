import { z } from 'zod';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

/**
 * حمولة حدث «اكتشف طلبات التقييم المستحقة» (D-B4).
 *
 * خطوة البيانات 0194 بتبعته لكل شركة عندها طلبات مجدولة لم تُطالب بها، عشان الجدولة تبدأ
 * من غير ما تستنى حدث زيارة جديد. الحمولة هوية الشركة بس: الباقي يتبقى من جدول الطلبات.
 */
export const ratingClaimsDiscoveryRequested = z
  .strictObject({
    company_id: id,
  })
  .meta({ id: 'RatingClaimsDiscoveryRequested' });
export type RatingClaimsDiscoveryRequested = z.infer<typeof ratingClaimsDiscoveryRequested>;

/** موضع الصفحة التالية؛ وجوده يعني أن الصفحة السابقة بلغت حدّها الأقصى. */
export const ratingClaimCursor = z.strictObject({ dueAt: timestamp, id });

/** بيانات مهمة المطالبة: الشركة، ومؤشر محدود يمنع تكرار أول صفحة إلى الأبد. */
export const ratingClaimsJob = z.strictObject({
  companyId: id,
  after: ratingClaimCursor.optional(),
});
export type RatingClaimsJob = z.infer<typeof ratingClaimsJob>;
