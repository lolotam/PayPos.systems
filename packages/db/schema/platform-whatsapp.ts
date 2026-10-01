import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });

export const platformWhatsappSuppressions = pgTable(
  'platform_whatsapp_suppressions',
  {
    recipientHash: bytea('recipient_hash').primaryKey(),
    hashKeyId: text('hash_key_id').notNull(),
    source: text('source').notNull(),
    firstOptedOutAt: time('first_opted_out_at').notNull(),
    lastOptedOutAt: time('last_opted_out_at').notNull(),
    // الموافقة الجديدة ممنوعة في المرحلة الأولى حتى بصلاحيات الصيانة.
    optedBackInAt: time('opted_back_in_at'),
  },
  (t) => [
    check('platform_whatsapp_suppressions_hash', sql`octet_length(${t.recipientHash}) = 32`),
    check('platform_whatsapp_suppressions_source', sql`${t.source} IN ('STOP','MANUAL')`),
    check('platform_whatsapp_suppressions_time', sql`${t.lastOptedOutAt} >= ${t.firstOptedOutAt}`),
    check('platform_whatsapp_suppressions_null_only', sql`${t.optedBackInAt} IS NULL`),
  ],
);

export const platformWhatsappInbox = pgTable(
  'platform_whatsapp_inbox',
  {
    id: uuid('id').primaryKey(),
    // البصمة الدائمة تمنع إعادة تطبيق الأمر بعد انتهاء احتفاظ الحمولة.
    providerMessageDigest: bytea('provider_message_digest').notNull(),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    command: text('command').notNull(),
    providerTimestamp: time('provider_timestamp').notNull(),
    receivedAt: time('received_at').notNull(),
    rawEvent: jsonb('raw_event'),
    suppressionAppliedAt: time('suppression_applied_at'),
    processedAt: time('processed_at'),
    enqueueConfirmedAt: time('enqueue_confirmed_at'),
  },
  (t) => [
    unique('platform_whatsapp_inbox_digest').on(t.providerMessageDigest),
    check(
      'platform_whatsapp_inbox_hash',
      sql`octet_length(${t.recipientHash}) = 32 AND octet_length(${t.providerMessageDigest}) = 32`,
    ),
    check('platform_whatsapp_inbox_command', sql`${t.command} IN ('STOP','OTHER')`),
    index('platform_whatsapp_inbox_enqueue_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.enqueueConfirmedAt} IS NULL`),
    index('platform_whatsapp_inbox_processing_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.processedAt} IS NULL`),
    index('platform_whatsapp_inbox_retention_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.rawEvent} IS NOT NULL`),
  ],
);

export const platformWhatsappAudit = pgTable(
  'platform_whatsapp_audit',
  {
    id: uuid('id').primaryKey(),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    source: text('source').notNull(),
    inboxId: uuid('inbox_id').references(() => platformWhatsappInbox.id),
    operatorId: uuid('operator_id'),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    occurredAt: time('occurred_at').notNull(),
  },
  (t) => [
    check('platform_whatsapp_audit_hash', sql`octet_length(${t.recipientHash}) = 32`),
    check(
      'platform_whatsapp_audit_actor',
      sql`(${t.source} = 'STOP' AND ${t.inboxId} IS NOT NULL AND ${t.operatorId} IS NULL AND ${t.reason} = 'RECIPIENT_STOP') OR (${t.source} = 'MANUAL' AND ${t.inboxId} IS NULL AND ${t.operatorId} IS NOT NULL AND ${t.reason} IN ('OPERATOR_REQUEST','ABUSE_PREVENTION'))`,
    ),
    check('platform_whatsapp_audit_action', sql`${t.action} = 'OPT_OUT'`),
    index('platform_whatsapp_audit_inbox_idx').on(t.inboxId),
  ],
);
