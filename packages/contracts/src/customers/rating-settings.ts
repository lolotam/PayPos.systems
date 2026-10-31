import { z } from 'zod';

import { responseObject } from '../response-object.js';

/**
 * حالة مفتاح طلبات التقييم لمّا ما يتخزّنش: مقفول، عشان ما يتفتحش طلبات للعملاء من غير ما يبقى في إعدادات.
 */
export const RATING_REQUESTS_DEFAULT_ENABLED = false;

/**
 * جسم طلب تبديل المفتاح: صارم، فحقل زيادة في الطلب لازم يترفض بدل ما يتجاهل.
 */
export const ratingSettings = z
  .strictObject({ requests_enabled: z.boolean() })
  .meta({ id: 'RatingSettings' });
export type RatingSettings = z.infer<typeof ratingSettings>;

/**
 * جسم رد المفتاح: مش صارم، لأن تبويب مفتوح في لوحة الإدارة بيفضل ماسك السكيما القديمة
 * وقت النشر المتدرّج، فحقل زيادة في الرد بيتشال بدل ما يسقط الشاشة كلها.
 */
export const ratingSettingsResponse = responseObject({ requests_enabled: z.boolean() }).meta({
  id: 'RatingSettingsResponse',
});
export type RatingSettingsResponse = z.infer<typeof ratingSettingsResponse>;
