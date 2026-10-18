import { z } from 'zod';
import { responseObject } from './response-object.js';

import { id } from './scalars/id.js';
import { timestamp } from './scalars/timestamp.js';
import { pageQuery } from './pagination/cursor.js';

const safeText = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|\b\d{4,8}\b)/i.test(value),
  );
// Display names reject a URL, a phone and a bare 4–8 digit code, and allow a year inside a name.
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
const shiftStart = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const displayParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: displayName });
export const inAppParameters = z.tuple([
  z.strictObject({ name: z.literal('subject'), type: z.literal('text'), value: safeText }),
]);
export const shiftNotClockedInParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('shift_start'), type: z.literal('text'), value: shiftStart }),
]);
export const breakNotReturnedParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('break_end'), type: z.literal('text'), value: shiftStart }),
]);
export const breakReturnedOtherBranchParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
]);
const inAppBase = {
  channel: z.literal('IN_APP'),
  user_id: id,
  locale: z.enum(['ar', 'en']),
  template_revision: z.literal(1),
};
export const lateServiceSessionParameters = z.tuple([
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('business_date'), type: z.literal('text'), value: z.iso.date() }),
]);
export const lateServiceSessionRecipient = z.strictObject({
  ...inAppBase, template_key: z.literal('late_service_session'), safe_parameters: lateServiceSessionParameters,
});
/** فلتر أمان للجرس أوسع من sessionMoney الذي يمنع الصفر البادئ، لأن منتج 35d-2 يمرّر قيمًا متحققة بـ sessionMoney أصلًا. */
const bellMoney = z.string().regex(/^\d{1,11}\.\d{3}$/);
const moneyParameter = <Name extends string>(name: Name) =>
  z.strictObject({ name: z.literal(name), type: z.literal('text'), value: bellMoney });
/** ترتيب ED-Q11 ثابت مع نص القالب؛ المبلغ ليس displayName لأن 1250.000 يُرفض كاسم. */
export const serviceLinePriceEditedParameters = z.tuple([
  displayParameter('service_name_ar'),
  displayParameter('service_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('business_date'), type: z.literal('text'), value: z.iso.date() }),
  moneyParameter('previous_net'),
  moneyParameter('new_net'),
  displayParameter('editor_name_ar'),
  displayParameter('editor_name_en'),
]);
/** مراجعة القالب 1 لأن نص ED-Q11 ثابت؛ تغيير النص لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const serviceLinePriceEditedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('service_line_price_edited'),
  safe_parameters: serviceLinePriceEditedParameters,
});
/** ترتيب القالب ثابت؛ المبلغ ليس displayName لأن 1250.000 يُرفض كاسم، والجرس بلا هوية المُلغي وبلا سبب. */
export const serviceLineCancelledParameters = z.tuple([
  displayParameter('service_name_ar'),
  displayParameter('service_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('business_date'), type: z.literal('text'), value: z.iso.date() }),
  moneyParameter('cancelled_net'),
]);
/** مراجعة القالب 1 لأن نص الإلغاء ثابت؛ تغيير النص لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const serviceLineCancelledRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('service_line_cancelled'),
  safe_parameters: serviceLineCancelledParameters,
});
/** ترتيب القالب ثابت؛ المبلغ ليس displayName لأن 1250.000 يُرفض كاسم، والجرس بلا سبب وبلا اسم منفّذ وبلا هوية من غيّر. */
export const serviceLinePerformersChangedParameters = z.tuple([
  displayParameter('service_name_ar'),
  displayParameter('service_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({ name: z.literal('business_date'), type: z.literal('text'), value: z.iso.date() }),
  moneyParameter('line_net'),
]);
/** مراجعة القالب 1 لأن نص تغيير المنفّذين ثابت؛ تغيير النص لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const serviceLinePerformersChangedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('service_line_performers_changed'),
  safe_parameters: serviceLinePerformersChangedParameters,
});
const changeParameter = z.strictObject({
  name: z.literal('change'),
  type: z.literal('text'),
  value: z.enum(['ADD_SESSION', 'VOID_SESSION', 'RESTORE_SESSION']),
});
export const attendanceChangeRequestedParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  changeParameter,
]);
export const attendanceChangeDecidedParameters = z.tuple([
  displayParameter('employee_name_ar'),
  displayParameter('employee_name_en'),
  changeParameter,
  z.strictObject({
    name: z.literal('decision'),
    type: z.literal('text'),
    value: z.enum(['APPROVED', 'REJECTED']),
  }),
  z.strictObject({ name: z.literal('reason'), type: z.literal('text'), value: safeText }),
]);
export const inAppRecipient = z.discriminatedUnion('template_key', [
  lateServiceSessionRecipient,
  serviceLinePriceEditedRecipient,
  serviceLineCancelledRecipient,
  serviceLinePerformersChangedRecipient,
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('break_returned_other_branch'),
    safe_parameters: breakReturnedOtherBranchParameters,
  }),
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('attendance_change_requested'),
    safe_parameters: attendanceChangeRequestedParameters,
  }),
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('attendance_change_decided'),
    safe_parameters: attendanceChangeDecidedParameters,
  }),
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('generic_notice'),
    safe_parameters: inAppParameters,
  }),
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('shift_not_clocked_in'),
    safe_parameters: shiftNotClockedInParameters,
  }),
  z.strictObject({
    ...inAppBase,
    template_key: z.literal('break_not_returned'),
    safe_parameters: breakNotReturnedParameters,
  }),
]);
const inAppNotificationBase = {
  id,
  company_id: id,
  business_id: id.nullable(),
  branch_id: id.nullable(),
  source_event_id: id,
  template_revision: z.literal(1),
  locale: z.enum(['ar', 'en']),
  created_at: timestamp,
  read_at: timestamp.nullable(),
};
export const inAppNotification = z
  .discriminatedUnion('template_key', [
    responseObject({
      ...inAppNotificationBase, template_key: z.literal('late_service_session'),
      safe_parameters: lateServiceSessionParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('service_line_price_edited'),
      safe_parameters: serviceLinePriceEditedParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('service_line_cancelled'),
      safe_parameters: serviceLineCancelledParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('service_line_performers_changed'),
      safe_parameters: serviceLinePerformersChangedParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('break_returned_other_branch'),
      safe_parameters: breakReturnedOtherBranchParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('attendance_change_requested'),
      safe_parameters: attendanceChangeRequestedParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('attendance_change_decided'),
      safe_parameters: attendanceChangeDecidedParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('generic_notice'),
      safe_parameters: inAppParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('shift_not_clocked_in'),
      safe_parameters: shiftNotClockedInParameters,
    }),
    responseObject({
      ...inAppNotificationBase,
      template_key: z.literal('break_not_returned'),
      safe_parameters: breakNotReturnedParameters,
    }),
  ])
  .meta({ id: 'InAppNotification' });
export const inAppNotificationQuery = pageQuery.meta({ id: 'InAppNotificationQuery' });
export const inAppNotificationPage = responseObject({
  items: z.array(inAppNotification),
  next_cursor: z.string().nullable(),
}).meta({ id: 'InAppNotificationPage' });
const inAppNotificationEnvelope = responseObject({
  items: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
});
// المراجعة المعروفة لكل قالب بتتقرأ من الـ literal بتاعه، فرفع مراجعة قالب واحد في السكيما كفاية وما فيش ثابت تاني ينسيه حد.
// القارئ بيفترض مراجعة واحدة مقروءة لكل قالب؛ رفع مراجعة أي قالب أو قراءة مراجعتين (صفوف قديمة مخزنة) لازم يعدّل القارئ ده في نفس الـ PR؛ اختبار response-object.spec بيفشل أول ما أي قالب يبطّل يعلن مراجعة 1.
const supportedRevisions = new Map<string, number>(
  inAppNotification.options.map((option) => [
    option.shape.template_key.value,
    option.shape.template_revision.value,
  ]),
);
const isFutureVersion = (item: unknown): boolean => {
  if (typeof item !== 'object' || item === null) return false;
  const { template_key: key, template_revision: revision } = item as Record<string, unknown>;
  if (typeof key !== 'string') return false;
  const supported = supportedRevisions.get(key);
  if (supported === undefined) return true;
  return typeof revision === 'number' && Number.isInteger(revision) && revision > supported;
};
/**
 * بيقرأ صفحة إشعارات الجرس ويتخطى الإشعار اللي قالبه أو مراجعته لسه نازلة بعد الحزمة دي.
 * حزمة متصفح مفتوحة ممكن توصلها صفحة فيها `template_key` جديد نزل مع نشر السيرفر؛ لو فشل عنصر واحد كانت الصفحة كلها بتفشل والجرس يقف لحد إعادة التحميل.
 * التخطي مقصور على قالب مش معروف أو مراجعة (template_revision) أحدث من اللي الحزمة بتفهمها؛ عنصر بقالب ومراجعة معروفين ومعاملاته غلط بيرمي خطأ ظاهر زي ما كان، عشان عيب السيرفر ما يستخباش.
 * العنصر المتخطي يظهر بعد ما الحزمة الجديدة تتحمل، وعداد غير المقروء بيفضل من السيرفر.
 *
 * @param data جسم الرد كما جاء من السيرفر
 * @returns الصفحة بالعناصر اللي الحزمة دي تفهمها، ومؤشر الصفحة التالية
 */
export function readInAppNotificationPage(data: unknown): InAppNotificationPage {
  const envelope = inAppNotificationEnvelope.parse(data);
  const items = envelope.items
    .filter((item) => !isFutureVersion(item))
    .map((item) => inAppNotification.parse(item));
  return { items, next_cursor: envelope.next_cursor };
}
export const notificationUnreadCount = responseObject({
  count: z.number().int().nonnegative(),
}).meta({ id: 'NotificationUnreadCount' });
export const notificationReadResult = responseObject({
  ok: z.literal(true),
}).meta({ id: 'NotificationReadResult' });
export type InAppRecipient = z.infer<typeof inAppRecipient>;
export type InAppNotification = z.infer<typeof inAppNotification>;
export type InAppNotificationQuery = z.infer<typeof inAppNotificationQuery>;
export type InAppNotificationPage = z.infer<typeof inAppNotificationPage>;
