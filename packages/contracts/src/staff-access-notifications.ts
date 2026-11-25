import { z } from 'zod';

import { inAppBase, inAppNotificationBase } from './in-app-base.js';
import { responseObject } from './response-object.js';
import { id } from './scalars/id.js';

// قواعد التنقية هنا مطابقة لِما في in-app-notifications.ts: اسم العرض يرفض الرابط والهاتف والرمز وحده،
// والساعة المحلية HH:MM. التكرار مقصود: in-app-notifications.ts يستورد مستلمي هذا الملف، فاستيراده
// منه هنا يخلق دائرة استيراد، والنسخة الأمينة في الملفين تتغير معًا في نفس الـ PR.
const displayName = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !/(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu.test(
        value.trim(),
      ),
  );
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const displayParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: displayName });
const dateParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: z.iso.date() });

/** حدث منح الدخول للموظفة: معرّفات بس — مفيش رقم سري ولا hash ولا هاتف (076-F2b-4). */
export const staffAccessGrantedEventPayload = z.strictObject({
  employee_id: id,
  user_id: id,
  membership_id: id,
  branch_id: id,
  role: z.enum(['staff', 'reception']),
});

/** حدث إعادة ضبط الرقم السري من غير نفسها: معرّفات بس — مفيش رقم سري ولا hash ولا هاتف (076-F2b-4). */
export const staffPinSetByOtherEventPayload = z.strictObject({
  employee_id: id,
  user_id: id,
  branch_id: id,
});

/**
 * معاملات جرسَي وصول الدخول: الموظفة والمنحِ والفرع وتاريخ ووقت الوصول.
 * الترتيب ثابت مع نص القالب، والتاريخ ميلادي والوقت HH:MM بتوقيت الفرع.
 */
export const staffAccessNoticeParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('actor_name_ar'),
  displayParameter('actor_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  dateParameter('occurred_date'),
  z.strictObject({ name: z.literal('occurred_time'), type: z.literal('text'), value: localTime }),
]);

/** مراجعة القالب 1 لأن نص جرس منح الدخول ثابت؛ تغييره لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const staffAccessGrantedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('staff_access_granted'),
  safe_parameters: staffAccessNoticeParameters,
});

/** مراجعة القالب 1 لأن نص جرس إعادة الضبط ثابت؛ تغييره لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const staffPinSetByOtherRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('staff_pin_set_by_other'),
  safe_parameters: staffAccessNoticeParameters,
});

/** صف جرس منح الدخول المقروء: نفس معاملات المستلم، مع هوية الصف ولحظتيه. */
export const staffAccessGrantedNotification = responseObject({
  ...inAppNotificationBase,
  template_key: z.literal('staff_access_granted'),
  safe_parameters: staffAccessNoticeParameters,
});

/** صف جرس إعادة الضبط المقروء: نفس معاملات المستلم، مع هوية الصف ولحظتيه. */
export const staffPinSetByOtherNotification = responseObject({
  ...inAppNotificationBase,
  template_key: z.literal('staff_pin_set_by_other'),
  safe_parameters: staffAccessNoticeParameters,
});

/** سقف مجموعة المستلمين في حدث الجرس؛ فوقي يرفضه العقد وما يوصل لحد. */
export const staffAccessNoticeGroupSize = 100;

/** جرس منح الدخول للمالكين: مجموعة مستلمين واحدة لكل مالك نشط، بلا رقم سري ولا هاتف (076-F2b-4). */
export const staffAccessGrantedNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    business_id: id,
    branch_id: id,
    employee_id: id,
    notification_recipients: z
      .array(staffAccessGrantedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(staffAccessNoticeGroupSize),
  })
  .meta({ id: 'StaffAccessGrantedNoticeRequested' });

/** جرس إعادة الضبط للمالكين: مجموعة مستلمين واحدة لكل مالك نشط، بلا رقم سري ولا هاتف (076-F2b-4). */
export const staffPinSetByOtherNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    business_id: id,
    branch_id: id,
    employee_id: id,
    notification_recipients: z
      .array(staffPinSetByOtherRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(staffAccessNoticeGroupSize),
  })
  .meta({ id: 'StaffPinSetByOtherNoticeRequested' });
