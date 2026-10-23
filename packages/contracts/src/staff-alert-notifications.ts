import { z } from 'zod';

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
const inAppBase = {
  channel: z.literal('IN_APP'),
  user_id: id,
  locale: z.enum(['ar', 'en']),
  template_revision: z.literal(1),
};

/**
 * معاملات جرس استثناء الحضور: الموظفة والفرع والتاريخ والوقت المحليين لبصمة الدخول المفتوحة (AL-Q8b).
 * الترتيب ثابت مع نص القالب، والوقت HH:MM بتوقيت الجلسة نفسها.
 */
export const attendanceExceptionRaisedParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  dateParameter('clock_in_date'),
  z.strictObject({ name: z.literal('clock_in_time'), type: z.literal('text'), value: localTime }),
]);

/** مراجعة القالب 1 لأن نص AL-Q8b ثابت؛ تغيير النص لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const attendanceExceptionRaisedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('attendance_exception_raised'),
  safe_parameters: attendanceExceptionRaisedParameters,
});

/**
 * معاملات جرس انتهاء المستند: الموظفة ونوع المستند وتاريخ الانتهاء بالظبط ومعرّف المستند (AL-Q8).
 * المعرّف هو معرّف المستند نفسه؛ رقم المستند لا يسافر في الحدث ولا في المعاملات (62-2e يعرضه وقت العرض).
 */
export const documentExpiringParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('document_type_ar'),
  displayParameter('document_type_en'),
  dateParameter('expires_on'),
  z.strictObject({ name: z.literal('document_id'), type: z.literal('text'), value: id }),
]);

/** مراجعة القالب 1 لأن نص AL-Q8 ثابت؛ تغييره لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const documentExpiringRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('document_expiring'),
  safe_parameters: documentExpiringParameters,
});
