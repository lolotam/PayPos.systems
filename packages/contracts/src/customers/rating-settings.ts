import { z } from 'zod';

/**
 * حالة مفتاح طلبات التقييم لمّا ما يتخزّنش: مقفول.
 * القيمة دي هي نفس اللي بيقراها الـ API والـ worker، فالتبديل مايفتحش طلبات للعالمين من غير ما يبقى في إعدادات.
 */
export const RATING_REQUESTS_DEFAULT_ENABLED = false;

/**
 * مفتاح طلبات التقييم للنشاط: هل النشاط بيبعت للعميل لينك تقييم ولا لأ.
 * نفس السكيما للطلب والرد — القيمّة نفسها هي اللي بتتخزّن.
 */
export const ratingSettings = z
  .strictObject({ requests_enabled: z.boolean() })
  .meta({ id: 'RatingSettings' });
export type RatingSettings = z.infer<typeof ratingSettings>;
