import { z } from 'zod';

import { id } from './scalars/id.js';
import { timestamp } from './scalars/timestamp.js';
import { pageQuery } from './pagination/cursor.js';
import { inAppRecipient } from './in-app-notifications.js';

export const notificationStatus = z.enum([
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'EXPIRED',
  'SUPPRESSED',
]);
export const notificationFailureCode = z.enum([
  'LOCALE_MISSING',
  'LOCALE_UNSUPPORTED',
  'DESTINATION_INVALID',
  'CONFIG_INVALID',
  'PARAMETERS_INVALID',
  'ADMISSION_REFUSED',
  'DEADLINE_EXPIRED',
  'SUPPRESSED',
  'PROVIDER_4XX',
  'PROVIDER_5XX',
  'NETWORK_UNKNOWN',
  'RESPONSE_INVALID',
]);
export const pushFailureCode = z.enum([
  'SUBSCRIPTION_GONE',
  'SUBSCRIPTION_CHANGED',
  'SUBSCRIPTION_REVOKED',
  'KEY_ROTATED',
  'VAPID_REJECTED',
  'PROVIDER_429',
]);
export const notificationParameter = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  type: z.enum(['text', 'number']),
  value: z.union([z.string().max(255), z.number().finite()]),
});
export const whatsappRecipient = z.strictObject({
  phone: z.string().max(32),
  locale: z.string().max(32).nullish(),
  channel: z.literal('whatsapp'),
  template_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  template_revision: z.number().int().positive(),
  safe_parameters: z.array(notificationParameter).max(20),
  send_deadline: timestamp.nullish(),
});
const emailRecipient = z.strictObject({
  email: z.string().max(254),
  locale: z.string().max(32).nullish(),
  channel: z.literal('email'),
  template_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  template_revision: z.number().int().positive(),
  safe_parameters: z.array(notificationParameter).max(20),
  send_deadline: timestamp.nullish(),
});
// مستلم الدفع: هوية المستخدم والقالب بس؛ مفيش هاتف ولا وجهة ولا لغة، لأنها بتتقرأ من الاشتراك نفسه.
export const pushRecipient = z.strictObject({
  channel: z.literal('PUSH'),
  user_id: id,
  template_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  template_revision: z.number().int().positive(),
  safe_parameters: z.array(notificationParameter).max(20),
  send_deadline: timestamp.nullish(),
});
export const notificationRecipient = z.union([
  z.discriminatedUnion('channel', [whatsappRecipient, emailRecipient]),
  inAppRecipient,
  pushRecipient,
]);
// إشعار الموظف لازم يسافر في طلب لوحده؛ ما يتخلطش بمجموعة المديرين (BR-008).
const pushIsAlone = (request: {
  notification_recipients: readonly { channel: string }[];
}): boolean => {
  const push = request.notification_recipients.filter((recipient) => recipient.channel === 'PUSH');
  return push.length === 0 || push.length === request.notification_recipients.length;
};
export const notificationRequest = z
  .object({
    business_id: id.nullish(),
    branch_id: id.nullish(),
    notification_recipients: z.array(notificationRecipient).min(1).max(100),
  })
  .refine((v) => v.branch_id == null || v.business_id != null)
  .refine(pushIsAlone);
export const notificationSendAuthorized = z.strictObject({ company_id: id, attempt_id: id });
export const pushSendAuthorized = z.strictObject({ company_id: id, attempt_id: id });
export const notificationResult = z
  .strictObject({
    company_id: id,
    attempt_id: id,
    source_event_id: id,
    business_id: id.nullable(),
    branch_id: id.nullable(),
    channel: z.enum(['whatsapp', 'email', 'IN_APP', 'PUSH']),
    recipient_user_id: id.optional(),
    template_key: z.string(),
    locale: z.enum(['ar', 'en']).nullable(),
    status: z.enum(['SENT', 'FAILED', 'EXPIRED', 'SUPPRESSED']),
    occurred_at: timestamp,
    evidence: z.enum(['PROVIDER_ACCEPTED', 'IN_APP_STORED', 'NONE']),
    failure_code: z.union([notificationFailureCode, pushFailureCode]).optional(),
    outcome_known: z.boolean(),
  })
  .refine((value) =>
    value.channel === 'IN_APP'
      ? value.recipient_user_id !== undefined &&
        value.locale !== null &&
        value.status === 'SENT' &&
        value.evidence === 'IN_APP_STORED' &&
        value.outcome_known &&
        value.failure_code === undefined
      : value.recipient_user_id === undefined && value.evidence !== 'IN_APP_STORED',
  );
export const deliveryLogItem = z
  .strictObject({
    id,
    company_id: id,
    business_id: id.nullable(),
    branch_id: id.nullable(),
    source_event_id: id,
    channel: z.enum(['whatsapp', 'email']),
    template_key: z.string(),
    template_revision: z.number().int(),
    locale: z.enum(['ar', 'en']).nullable(),
    phone_last3: z
      .string()
      .regex(/^\d{3}$/)
      .nullable(),
    status: notificationStatus,
    authorized_at: timestamp,
    send_deadline: timestamp.nullable(),
    sending_at: timestamp.nullable(),
    finished_at: timestamp.nullable(),
    provider_message_id: z.string().nullable(),
    failure_code: notificationFailureCode.nullable(),
    outcome_known: z.boolean().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .refine((value) =>
    value.channel === 'email' ? value.phone_last3 === null : value.phone_last3 !== null,
  )
  .meta({ id: 'DeliveryLogItem' });
export const deliveryLogQuery = pageQuery.meta({ id: 'DeliveryLogQuery' });
export const deliveryLogPage = z
  .strictObject({
    items: z.array(deliveryLogItem),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'DeliveryLogPage' });
export type NotificationRecipient = z.infer<typeof notificationRecipient>;
export type NotificationSendAuthorized = z.infer<typeof notificationSendAuthorized>;
export type PushRecipient = z.infer<typeof pushRecipient>;
export type PushSendAuthorized = z.infer<typeof pushSendAuthorized>;
export type PushFailureCode = z.infer<typeof pushFailureCode>;
export type NotificationResult = z.infer<typeof notificationResult>;
export type DeliveryLogItem = z.infer<typeof deliveryLogItem>;
export type DeliveryLogQuery = z.infer<typeof deliveryLogQuery>;
