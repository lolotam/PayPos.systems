import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });

// The three global tables of the email feedback class (spec 075): hashes and identifiers only, no
// company, no tenant RLS, no address.
export const platformEmailSuppressions = pgTable(
  'platform_email_suppressions',
  {
    recipientHash: bytea('recipient_hash').primaryKey(),
    hashKeyId: text('hash_key_id').notNull(),
    source: text('source').notNull(),
    firstSuppressedAt: time('first_suppressed_at').notNull(),
    lastSuppressedAt: time('last_suppressed_at').notNull(),
    // رفع الحظر مش من المرحلة دي؛ القيد المتحقق منه بيمنع أي قيمة تانية.
    liftedAt: time('lifted_at'),
  },
  (t) => [
    check('platform_email_suppressions_hash', sql`octet_length(${t.recipientHash}) = 32`),
    check(
      'platform_email_suppressions_source',
      sql`${t.source} IN ('BOUNCE','COMPLAINT','PROVIDER','MANUAL')`,
    ),
    check(
      'platform_email_suppressions_time',
      sql`${t.lastSuppressedAt} >= ${t.firstSuppressedAt}`,
    ),
    check('platform_email_suppressions_null_only', sql`${t.liftedAt} IS NULL`),
  ],
);

export const platformEmailFeedbackInbox = pgTable(
  'platform_email_feedback_inbox',
  {
    id: uuid('id').primaryKey(),
    // البصمة الدائمة بتخلي إعادة تسليم نفس الحدث مرفوضة حتى بعد مسح الحمولة.
    providerEventDigest: bytea('provider_event_digest').notNull(),
    providerEmailId: text('provider_email_id').notNull(),
    eventType: text('event_type').notNull(),
    bounceClass: text('bounce_class'),
    providerTimestamp: time('provider_timestamp').notNull(),
    receivedAt: time('received_at').notNull(),
    rawEvent: jsonb('raw_event'),
    enqueueConfirmedAt: time('enqueue_confirmed_at'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: time('next_attempt_at'),
    resolvedAt: time('resolved_at'),
    quarantinedAt: time('quarantined_at'),
    quarantineReason: text('quarantine_reason'),
  },
  (t) => [
    unique('platform_email_feedback_inbox_digest').on(t.providerEventDigest),
    check(
      'platform_email_feedback_inbox_digest_bytes',
      sql`octet_length(${t.providerEventDigest}) = 32`,
    ),
    check(
      'platform_email_feedback_inbox_event_type',
      sql`${t.eventType} IN ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed')`,
    ),
    check(
      'platform_email_feedback_inbox_bounce_class',
      sql`${t.bounceClass} IS NULL OR ${t.bounceClass} IN ('PERMANENT','TRANSIENT')`,
    ),
    check(
      'platform_email_feedback_inbox_state',
      sql`NOT (${t.resolvedAt} IS NOT NULL AND ${t.quarantinedAt} IS NOT NULL)`,
    ),
    check(
      'platform_email_feedback_inbox_quarantine_reason',
      sql`${t.quarantineReason} IS NULL OR ${t.quarantineReason} IN ('TAGS_INVALID','RETRIEVAL_EXHAUSTED','ATTEMPT_NOT_FOUND','HASH_MISMATCH','STATE_INELIGIBLE','EXECUTION_MISSING','PROVIDER_ID_CONFLICT','CROSS_TENANT')`,
    ),
    check('platform_email_feedback_inbox_attempts', sql`${t.attempts} >= 0`),
    index('platform_email_feedback_inbox_enqueue_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.enqueueConfirmedAt} IS NULL`),
    index('platform_email_feedback_inbox_pending_idx')
      .on(t.nextAttemptAt, t.id)
      .where(sql`${t.resolvedAt} IS NULL AND ${t.quarantinedAt} IS NULL`),
    index('platform_email_feedback_inbox_retention_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.rawEvent} IS NOT NULL`),
  ],
);

export const platformEmailAudit = pgTable(
  'platform_email_audit',
  {
    id: uuid('id').primaryKey(),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    source: text('source').notNull(),
    inboxId: uuid('inbox_id').references(() => platformEmailFeedbackInbox.id),
    operatorId: uuid('operator_id'),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    occurredAt: time('occurred_at').notNull(),
  },
  (t) => [
    check('platform_email_audit_hash', sql`octet_length(${t.recipientHash}) = 32`),
    check(
      'platform_email_audit_actor',
      sql`(${t.source} IN ('BOUNCE','COMPLAINT','PROVIDER') AND ${t.inboxId} IS NOT NULL AND ${t.operatorId} IS NULL AND ${t.reason} IN ('PERMANENT_BOUNCE','COMPLAINT','PROVIDER_SUPPRESSION')) OR (${t.source} = 'MANUAL' AND ${t.inboxId} IS NULL AND ${t.operatorId} IS NOT NULL AND ${t.reason} IN ('OPERATOR_REQUEST','ABUSE_PREVENTION'))`,
    ),
    check('platform_email_audit_action', sql`${t.action} = 'SUPPRESS'`),
    index('platform_email_audit_inbox_idx').on(t.inboxId),
  ],
);
