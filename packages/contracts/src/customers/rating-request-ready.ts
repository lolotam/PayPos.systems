import { z } from 'zod';

import { notificationParameter, whatsappRecipient } from '../notifications.js';
import { id } from '../scalars/id.js';

/** اسم قالب رسالة التقييم؛ تفعيل القالب نفسه شغل 59b-3 (SC-004). */
export const RATING_REQUEST_TEMPLATE_KEY = 'rating_request';

/** مراجعة القالب المرسلة مع الحدث؛ أي تغيير في النص بيبقى مراجعة جديدة. */
export const RATING_REQUEST_TEMPLATE_REVISION = 1;

/** رقم العميل بصيغة E.164، بنفس نمط قيد قاعدة البيانات `customers_phone_e164`. */
const customerPhoneE164 = z.string().regex(/^\+[1-9]\d{1,14}$/);

/** أسماء المعاملات الآمنة اللي المطالبة بتنتجها بالظبط (D-B6). */
const RATING_PARAMETER_NAMES: readonly string[] = [
  'customer_first_name',
  'business_name',
  'performers',
  'rating_request_id',
];

/** أسماء المعاملات اللي لازم تكون موجودة في كل رسالة؛ `customer_first_name` اختياري. */
const REQUIRED_RATING_PARAMETER_NAMES: readonly string[] = [
  'business_name',
  'performers',
  'rating_request_id',
];

/**
 * معامل آمن واحد لرسالة التقييم: اسمه لازم يكون من الأسماء اللي المطالبة بتنتجها.
 * اسم `token` مرفوض صريح — التوكن نفسه مش جزء من الرسالة (ADR-0011 §1).
 */
const ratingSafeParameter = notificationParameter.superRefine((parameter, ctx) => {
  if (parameter.name === 'token') {
    ctx.addIssue({ code: 'custom', message: 'RATING_PARAMETER_TOKEN_REFUSED' });
    return;
  }
  if (!RATING_PARAMETER_NAMES.includes(parameter.name)) {
    ctx.addIssue({ code: 'custom', message: 'RATING_PARAMETER_UNKNOWN' });
  }
});

/**
 * معاملات الرسالة الآمنة كلها: من غير تكرار، ومن غير ما ينقص اسم مطلوب.
 * `customer_first_name` اختياري لأنه يُشطب لما مفيش اسم آمن للعرض (D-B6).
 */
const ratingSafeParameters = z
  .array(ratingSafeParameter)
  .max(RATING_PARAMETER_NAMES.length)
  .superRefine((parameters, ctx) => {
    const names = parameters.map((parameter) => parameter.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', message: 'RATING_PARAMETER_DUPLICATE' });
    }
    for (const required of REQUIRED_RATING_PARAMETER_NAMES) {
      if (!names.includes(required)) {
        ctx.addIssue({ code: 'custom', message: 'RATING_PARAMETER_MISSING' });
      }
    }
  });

/**
 * مستقبل الرسالة: نفس مستقبل الإشعارات، بس بحقول مثبّتة على اللي المطالبة بتنتجه.
 * الهاتف بصيغة E.164 بتاع العميل (نفس نمط قيد `customers_phone_e164`)،
 * واللغة عربية أو إنجليزية زي ما `customers.locale` بيضمنها، والقالب ومراجعته ثابتين.
 */
const ratingRecipient = whatsappRecipient.extend({
  phone: customerPhoneE164,
  locale: z.enum(['ar', 'en']),
  template_key: z.literal(RATING_REQUEST_TEMPLATE_KEY),
  template_revision: z.literal(RATING_REQUEST_TEMPLATE_REVISION),
  safe_parameters: ratingSafeParameters,
});

/**
 * حمولة حدث «طلب التقييم جاهز» (D-B6).
 *
 * الحدث بيتنشر في معاملة المطالبة نفسها، لحظة تحريك الطلب من `SCHEDULED` إلى `SENDING`.
 *
 * الشكل هو نفسه اللي `notifications` بيقراه (`notification_recipients`)، فما فيش تعديل في
 * جانب الإشعارات: المستقبل واحد على واتساب، ورقم العميل ولغته والقالب ومراجعته والمعاملات
 * الآمنة وآخر موعد للإرسال كلهم جوه المستقبِل.
 *
 * بس المستقبل نفسه مثبّت على اللي المطالبة بتنتجه بالظبط: الهاتف بصيغة E.164 بتاع العميل
 * (نفس نمط قيد `customers_phone_e164`)، واللغة `'ar'` أو `'en'` زي ما `customers.locale`
 * بيضمنها، والقالب `rating_request` بمراجعته.
 *
 * الحقول اللي الإشعارات ما بتقراهاش موجودة فوق: هوية الطلب والحدث وإصدار مفتاح الاشتقاق،
 * عشان نتتبع الطلب من الحدث من غير ما نقرا جدول الطلبات تاني.
 *
 * التوكن نفسه مش جزء من الحمولة: البصمة بس اللي بتتسجل في صف الطلب (ADR-0011 §1).
 * ومعاملات الرسالة مقيدة بأسماء المطالبة بالظبط: `customer_first_name` (اختياري)،
 * `business_name`، `performers` و`rating_request_id`.
 */
export const ratingRequestReady = z
  .strictObject({
    event_id: id,
    company_id: id,
    business_id: id,
    branch_id: id.nullish(),
    rating_request_id: id,
    token_key_version: z.number().int().positive(),
    notification_recipients: z.array(ratingRecipient).min(1).max(1),
  })
  .meta({ id: 'RatingRequestReady' });
export type RatingRequestReady = z.infer<typeof ratingRequestReady>;
