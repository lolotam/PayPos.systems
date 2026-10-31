import { z } from 'zod';

/**
 * حالة مفتاح طلبات التقييم لمّا ما يتخزّنش: مقفول، عشان ما يتفتحش طلبات للعملاء من غير ما يبقى في إعدادات.
 */
export const RATING_REQUESTS_DEFAULT_ENABLED = false;

/**
 * مفتاح طلبات التقييم للنشاط: هل النشاط بيبعت للعميل لينك تقييم ولا لأ.
 * نفس السكيما للطلب والرد — القيمة نفسها هي اللي بتتخزّن.
 */
export const ratingSettings = z
  .strictObject({ requests_enabled: z.boolean() })
  .meta({ id: 'RatingSettings' });
export type RatingSettings = z.infer<typeof ratingSettings>;
