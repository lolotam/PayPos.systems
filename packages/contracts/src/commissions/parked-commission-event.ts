import { z } from 'zod';

import { inAppBase } from '../in-app-base.js';
import { id } from '../scalars/id.js';

/** حجم مجموعة مستلمين الجرس الأقصى؛ حدث الجرس بيقبل مية مستلم كحد أقصى. */
export const commissionEventParkedNoticeGroupSize = 100;

/** اسم نوع الحدث الموقوف: اسم تقني بلا أرقام، فهو معامل آمن في نص الجرس. */
const parkedEventType = z.string().regex(/^[A-Z][A-Za-z0-9]{1,99}$/);

/** معاملات جرس الحدث الموقوف: نوع الحدث ورقمه المرجعي، بالترتيب نفسه. */
export const commissionEventParkedParameters = z.tuple([
  z.strictObject({ name: z.literal('event_type'), type: z.literal('text'), value: parkedEventType }),
  z.strictObject({ name: z.literal('event_id'), type: z.literal('text'), value: id }),
]);

/** مراجعة القالب 1 لأن نص الإشعار ثابت؛ تغييره لاحقًا مراجعة جديدة. */
export const commissionEventParkedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('commission_event_parked'),
  safe_parameters: commissionEventParkedParameters,
});

/**
 * حدث جرس الحدث الموقوف: بيتكتب مرة واحدة لكل مجموعة مستلمين (مئة على الأكثر)
 * في نفس معاملة التنبيه، وبيحمل هوية الحدث الموقوف ورقم المجموعة.
 * لا حمولة ولا مبلغ ولا اسم موظفة ولا بيانات عميل (ADR-0012 §3).
 */
export const commissionEventParkedNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    event_id: id,
    event_type: parkedEventType,
    group_index: z.number().int().nonnegative(),
    notification_recipients: z
      .array(commissionEventParkedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(commissionEventParkedNoticeGroupSize),
  })
  .meta({ id: 'CommissionEventParkedNoticeRequested' });

export type CommissionEventParkedNoticeRequested = z.infer<
  typeof commissionEventParkedNoticeRequested
>;
