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
export const notificationRecipient = z.discriminatedUnion('channel', [
  whatsappRecipient,
  inAppRecipient,
]);
export const notificationRequest = z
  .object({
    business_id: id.nullish(),
    branch_id: id.nullish(),
    notification_recipients: z.array(notificationRecipient).min(1).max(100),
  })
  .refine((v) => v.branch_id == null || v.business_id != null);
export const notificationSendAuthorized = z.strictObject({ company_id: id, attempt_id: id });
export const notificationResult = z
  .strictObject({
    company_id: id,
    attempt_id: id,
    source_event_id: id,
    business_id: id.nullable(),
    branch_id: id.nullable(),
    channel: z.enum(['whatsapp', 'IN_APP']),
    recipient_user_id: id.optional(),
    template_key: z.string(),
    locale: z.enum(['ar', 'en']).nullable(),
    status: z.enum(['SENT', 'FAILED', 'EXPIRED', 'SUPPRESSED']),
    occurred_at: timestamp,
    evidence: z.enum(['PROVIDER_ACCEPTED', 'IN_APP_STORED', 'NONE']),
    failure_code: notificationFailureCode.optional(),
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
    channel: z.literal('whatsapp'),
    template_key: z.string(),
    template_revision: z.number().int(),
    locale: z.enum(['ar', 'en']).nullable(),
    phone_last3: z.string().regex(/^\d{3}$/),
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
export type NotificationResult = z.infer<typeof notificationResult>;
export type DeliveryLogItem = z.infer<typeof deliveryLogItem>;
export type DeliveryLogQuery = z.infer<typeof deliveryLogQuery>;
