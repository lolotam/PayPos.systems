import { z } from 'zod';

import { id } from './scalars/id.js';
import { timestamp } from './scalars/timestamp.js';
import { pageQuery } from './pagination/cursor.js';

const safeSubject = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|\b\d{4,8}\b)/i.test(value),
  );
export const inAppParameters = z.tuple([
  z.strictObject({ name: z.literal('subject'), type: z.literal('text'), value: safeSubject }),
]);
export const inAppRecipient = z.strictObject({
  channel: z.literal('IN_APP'),
  user_id: id,
  locale: z.enum(['ar', 'en']),
  template_key: z.literal('generic_notice'),
  template_revision: z.literal(1),
  safe_parameters: inAppParameters,
});
export const inAppNotification = z
  .strictObject({
    id,
    company_id: id,
    business_id: id.nullable(),
    branch_id: id.nullable(),
    source_event_id: id,
    template_key: z.literal('generic_notice'),
    template_revision: z.literal(1),
    locale: z.enum(['ar', 'en']),
    safe_parameters: inAppParameters,
    created_at: timestamp,
    read_at: timestamp.nullable(),
  })
  .meta({ id: 'InAppNotification' });
export const inAppNotificationQuery = pageQuery.meta({ id: 'InAppNotificationQuery' });
export const inAppNotificationPage = z
  .strictObject({
    items: z.array(inAppNotification),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'InAppNotificationPage' });
export const notificationUnreadCount = z
  .strictObject({
    count: z.number().int().nonnegative(),
  })
  .meta({ id: 'NotificationUnreadCount' });
export const notificationReadResult = z
  .strictObject({
    ok: z.literal(true),
  })
  .meta({ id: 'NotificationReadResult' });
export type InAppRecipient = z.infer<typeof inAppRecipient>;
export type InAppNotification = z.infer<typeof inAppNotification>;
export type InAppNotificationQuery = z.infer<typeof inAppNotificationQuery>;
export type InAppNotificationPage = z.infer<typeof inAppNotificationPage>;
