import { z } from 'zod';

import { whatsappRecipient } from '../notifications.js';
import { id } from '../scalars/id.js';

/** اسم قالب رسالة التقييم؛ تفعيل القالب نفسه شغل 59b-3 (SC-004). */
export const RATING_REQUEST_TEMPLATE_KEY = 'rating_request';

/** مراجعة القالب المرسلة مع الحدث؛ أي تغيير في النص بيبقى مراجعة جديدة. */
export const RATING_REQUEST_TEMPLATE_REVISION = 1;

/**
 * حمولة حدث «طلب التقييم جاهز» (D-B6).
 *
 * الشكل هو نفسه اللي `notifications` بيقراه (`notification_recipients`)، فما فيش تعديل في
 * جانب الإشعارات: المستقبل واحد على واتساب، ورقم العميل ولغته والقالب ومراجعته والمعاملات
 * الآمنة وآخر موعد للإرسال كلهم جوه المستقبِل.
 *
 * الحقول اللي الإشعارات ما بتقراهاش موجودة فوق: هوية الطلب والحدث وإصدار مفتاح الاشتقاق،
 * عشان نتتبع الطلب من الحدث من غير ما نقرا جدول الطلبات تاني.
 *
 * التوكن نفسه مش جزء من الحمولة: البصمة بس اللي بتتسجل في صف الطلب (ADR-0011 §1).
 */
export const ratingRequestReady = z
  .strictObject({
    event_id: id,
    company_id: id,
    business_id: id,
    branch_id: id.nullish(),
    rating_request_id: id,
    token_key_version: z.number().int().positive(),
    notification_recipients: z.array(whatsappRecipient).min(1).max(1),
  })
  .meta({ id: 'RatingRequestReady' });
export type RatingRequestReady = z.infer<typeof ratingRequestReady>;
