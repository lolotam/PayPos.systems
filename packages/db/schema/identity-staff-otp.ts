import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });

// هوية عامة، سياق الجهاز قيد على الاعتماد وليس تصريحاً بقراءة شركة.
export const authOtpChallenges = pgTable(
  'auth_otp_challenges',
  {
    id: uuid('id').primaryKey(),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    deviceContext: jsonb('device_context').notNull(),
    // بصمة موقعة بمفتاح مستقل؛ لا تسمح بتجريب المجال الصغير عند تسريب قاعدة البيانات.
    codeMac: bytea('code_mac'),
    derivationKeyId: text('derivation_key_id'),
    verificationKeyId: text('verification_key_id'),
    status: text('status').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    createdAt: time('created_at').notNull(),
    expiresAt: time('expires_at').notNull(),
    consumedAt: time('consumed_at'),
    finishedAt: time('finished_at'),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    check(
      'auth_otp_challenges_hash',
      sql`octet_length(${t.recipientHash}) = 32 AND (${t.codeMac} IS NULL OR octet_length(${t.codeMac}) = 32)`,
    ),
    check(
      'auth_otp_challenges_status',
      sql`${t.status} IN ('ACTIVE','CONSUMED','EXHAUSTED','EXPIRED','SUPERSEDED','SUPPRESSED')`,
    ),
    check(
      'auth_otp_challenges_attempts',
      sql`${t.failedAttempts} BETWEEN 0 AND 5 AND (${t.status} <> 'EXHAUSTED' OR ${t.failedAttempts} = 5)`,
    ),
    check(
      'auth_otp_challenges_expiry',
      sql`${t.expiresAt} = ${t.createdAt} + interval '300 seconds'`,
    ),
    check(
      'auth_otp_challenges_terminal',
      sql`(${t.status} = 'ACTIVE' AND ${t.codeMac} IS NOT NULL AND ${t.userId} IS NOT NULL AND ${t.derivationKeyId} IS NOT NULL AND ${t.verificationKeyId} IS NOT NULL AND ${t.finishedAt} IS NULL AND ${t.consumedAt} IS NULL) OR (${t.status} <> 'ACTIVE' AND ${t.codeMac} IS NULL AND ${t.finishedAt} IS NOT NULL AND ((${t.status} = 'CONSUMED') = (${t.consumedAt} IS NOT NULL)))`,
    ),
    check(
      'auth_otp_challenges_context',
      sql`jsonb_typeof(${t.deviceContext}) = 'object'
        AND (${t.deviceContext}->>'companyId') ~ '^[a-f0-9-]{36}$'
        AND (${t.deviceContext}->>'businessId') ~ '^[a-f0-9-]{36}$'
        AND ((${t.deviceContext} ?& ARRAY['companyId','businessId','branchId','deviceId']
          AND ${t.deviceContext} - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb
          AND (${t.deviceContext}->>'branchId') ~ '^[a-f0-9-]{36}$'
          AND (${t.deviceContext}->>'deviceId') ~ '^[a-f0-9-]{36}$')
        OR (${t.deviceContext} ?& ARRAY['purpose','companyId','businessId']
          AND ${t.deviceContext} - ARRAY['purpose','companyId','businessId'] = '{}'::jsonb
          AND ${t.deviceContext}->>'purpose' = 'STAFF_PERSONAL'))`,
    ),
    index('auth_otp_challenges_phone_idx').on(t.recipientHash, t.status, t.createdAt, t.id),
    index('auth_otp_challenges_user_idx').on(t.userId),
    index('auth_otp_challenges_expiry_idx').on(t.expiresAt, t.id),
  ],
);

export const authNotificationAttempts = pgTable(
  'auth_notification_attempts',
  {
    id: uuid('id').primaryKey(),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => authOtpChallenges.id),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    channel: text('channel').notNull(),
    templateKey: text('template_key').notNull(),
    templateRevision: integer('template_revision').notNull(),
    locale: text('locale').notNull(),
    providerTemplateName: text('provider_template_name'),
    status: text('status').notNull(),
    authorizedAt: time('authorized_at'),
    sendDeadline: time('send_deadline').notNull(),
    // نفس الموعد المختار قبل البحث؛ الاستهلاك لا يبدأ مهلة جديدة.
    preparationDeadline: time('preparation_deadline').notNull(),
    executionId: uuid('execution_id'),
    sendingAt: time('sending_at'),
    finishedAt: time('finished_at'),
    failureCode: text('failure_code'),
    outcomeKnown: boolean('outcome_known'),
    providerMessageDigest: bytea('provider_message_digest'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    unique('auth_notification_attempts_send_key').on(
      t.challengeId,
      t.channel,
      t.recipientHash,
      t.templateKey,
    ),
    check(
      'auth_notification_attempts_template',
      sql`${t.channel} = 'WHATSAPP' AND ${t.templateKey} = 'staff_otp' AND ${t.templateRevision} = 1 AND ${t.locale} IN ('ar','en')`,
    ),
    check(
      'auth_notification_attempts_hash',
      sql`octet_length(${t.recipientHash}) = 32 AND (${t.providerMessageDigest} IS NULL OR octet_length(${t.providerMessageDigest}) = 32)`,
    ),
    check(
      'auth_notification_attempts_status',
      sql`${t.status} IN ('PREPARED','PENDING','SENDING','SENT','FAILED','EXPIRED','SUPPRESSED')`,
    ),
    check(
      'auth_notification_attempts_authorization',
      sql`(${t.status} NOT IN ('PREPARED','SUPPRESSED') OR ${t.authorizedAt} IS NULL) AND (${t.status} NOT IN ('PENDING','SENDING','SENT') OR ${t.authorizedAt} IS NOT NULL) AND (${t.authorizedAt} IS NULL OR ${t.authorizedAt} < ${t.preparationDeadline})`,
    ),
    check(
      'auth_notification_attempts_fence',
      sql`(${t.executionId} IS NULL) = (${t.sendingAt} IS NULL) AND (${t.status} NOT IN ('SENDING','SENT') OR ${t.executionId} IS NOT NULL)`,
    ),
    check(
      'auth_notification_attempts_terminal',
      sql`(${t.status} IN ('PREPARED','PENDING','SENDING')) = (${t.finishedAt} IS NULL)`,
    ),
    check(
      'auth_notification_attempts_deadline',
      sql`${t.preparationDeadline} = ${t.createdAt} + interval '200 milliseconds' AND ${t.sendDeadline} = ${t.createdAt} + interval '300 seconds'`,
    ),
    index('auth_notification_attempts_challenge_idx').on(
      t.challengeId,
      t.status,
      t.createdAt,
      t.id,
    ),
    index('auth_notification_attempts_user_idx').on(t.userId),
    index('auth_notification_attempts_expiry_idx').on(t.sendDeadline, t.id),
  ],
);
