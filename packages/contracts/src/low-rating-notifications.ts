import { z } from 'zod';

import { id } from './scalars/id.js';

// نفس فلتر اسم العرض في in-app-notifications.ts (رابط، هاتف، رمز وحده)، لكن الطول هنا بالـ code points
// زي حدود قاعدة البيانات، عشان اسم إيموجي مسموح في الجدول ما يترفضش في الجرس. ما يتستوردش من هناك
// عشان in-app-notifications.ts هو اللي بيستورد الملف ده (دائرة)؛ والحزمة @pospay/notifications فيها نسخة مطابقة
// يثبتها اختبار التطابق في الـ worker.
const DISPLAY_NAME_UNSAFE =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;
const ratingDisplayName = (maxCodePoints: 200 | 255) =>
  z
    .string()
    .refine(
      (value) =>
        value.length > 0 &&
        value.length <= maxCodePoints * 2 &&
        value === value.trim() &&
        Array.from(value).length <= maxCodePoints &&
        !DISPLAY_NAME_UNSAFE.test(value),
    );
// null = الاسم غايب أو مش آمن، والعارض بيختار التسمية العامة المترجمة.
const performerName = z.strictObject({
  name_ar: ratingDisplayName(255).nullable(),
  name_en: ratingDisplayName(255).nullable(),
});
// التعليق المخزّن في صف الجرس: نص بحد الطول بس، مش قاعدة الإرسال ratingComment. قاعدة الإرسال قابلة للتشديد بمرور الوقت، وقاعدة
// جرس بتتحكم فيها كانت هتخلي تعليقًا اتقبل وقت التخزين يفشل عند إنشاء الجرس (فمفيش مدير ياخد إشعار) أو صفًا مخزنًا يبطّل يتقرا
// فتفشل صفحة الجرس كلها. الحد هو قيد قاعدة البيانات ratings_comment_length (1000 code point، يعني 2000 وحدة UTF-16 على الأكتر)،
// والعارض بيعرضه نص متهرب مش رابط (RT-Q17، ADR-0011 §4). النسخة المطابقة في الحزمة: storedCommentAllowed في @pospay/notifications.
const storedRatingComment = z
  .string()
  .refine((value) => value.length <= 2000 && Array.from(value).length <= 1000)
  .meta({
    maxLength: 1000,
    description: 'The customer comment as stored, shown as plain text; at most 1000 characters.',
  });
const detailsBase = {
  stars: z.union([z.literal(1), z.literal(2)]),
  branch_name_ar: ratingDisplayName(255).nullable(),
  branch_name_en: ratingDisplayName(255).nullable(),
  business_date: z.iso.date(),
  // كل المنفّذين في لقطة التقييم بترتيب المعرّف، من غير حد أقصى ومن غير تسمية فريق (RT-23).
  performers: z.array(performerName),
  customer_name: ratingDisplayName(200).nullable(),
  // آخر رقمين أو ٣ زي maskPhone في العملاء؛ رقم أقصر من ٣ ما يتملاش.
  phone_last3: z.string().regex(/^[0-9]{2,3}$/),
};

/** تفاصيل جرس التقييم المنخفض من غير تعليق: مفتاح comment مرفوض هنا (RT-Q9). */
export const lowRatingDetailsV1 = z.strictObject(detailsBase);
/** تفاصيل جرس التقييم المنخفض لقارئ التعليق: التعليق إجباري وحده الأقصى بس (storedRatingComment) عشان قاعدة الإرسال الحالية ما تتحكمش في صف مخزن. */
export const lowRatingCommentDetailsV1 = z.strictObject({
  ...detailsBase,
  comment: storedRatingComment,
});

/** معامل واحد بالظبط من نوع details؛ مش SafeParameter نصي لأن التفاصيل كائن له شكل ثابت. */
export const lowRatingParameters = z.tuple([
  z.strictObject({
    name: z.literal('details'),
    type: z.literal('details'),
    value: lowRatingDetailsV1,
  }),
]);
export const lowRatingCommentParameters = z.tuple([
  z.strictObject({
    name: z.literal('details'),
    type: z.literal('details'),
    value: lowRatingCommentDetailsV1,
  }),
]);
const inAppBase = {
  channel: z.literal('IN_APP'),
  user_id: id,
  locale: z.enum(['ar', 'en']),
  template_revision: z.literal(1),
};

/** مراجعة القالب 1؛ أي تغيير في شكل التفاصيل مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const lowRatingRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('low_rating'),
  safe_parameters: lowRatingParameters,
});
/** نفس الجرس لمن يملك قراءة التعليق؛ المفتاحان منفصلان عشان كل مستلم ياخد شكلًا واحدًا ثابتًا. */
export const lowRatingCommentRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('low_rating_with_comment'),
  safe_parameters: lowRatingCommentParameters,
});

export type LowRatingDetailsV1 = z.infer<typeof lowRatingDetailsV1>;
export type LowRatingCommentDetailsV1 = z.infer<typeof lowRatingCommentDetailsV1>;
