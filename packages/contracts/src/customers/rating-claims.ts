import { z } from 'zod';

import { id } from '../scalars/id.js';

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

/** بيانات مهمة المطالبة: هوية الشركة وحدها، وكل حاجة تانية بتتقري من جدول الطلبات. */
export const ratingClaimsJob = z.strictObject({ companyId: id });
export type RatingClaimsJob = z.infer<typeof ratingClaimsJob>;
