import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches, businesses, companies } from './tenancy.ts';
import { user } from './identity-auth.ts';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => user.id),
    businessId: uuid('business_id'),
    branchId: uuid('branch_id'),
    // هوية المصدر تبقى بعد حذف outbox حتى لا تعيد إعادة التسليم إنشاء الإشعار.
    sourceEventId: uuid('source_event_id').notNull(),
    templateKey: text('template_key').notNull(),
    templateRevision: integer('template_revision').notNull(),
    locale: text('locale').notNull(),
    safeParameters: jsonb('safe_parameters').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'in_app_notifications_pkey', columns: [t.companyId, t.id] }),
    unique('in_app_notifications_identity').on(
      t.companyId,
      t.sourceEventId,
      t.recipientUserId,
      t.templateKey,
    ),
    foreignKey({
      name: 'in_app_notifications_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'in_app_notifications_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    check('in_app_notifications_scope', sql`${t.branchId} IS NULL OR ${t.businessId} IS NOT NULL`),
    check('in_app_notifications_locale', sql`${t.locale} IN ('ar','en')`),
    check('in_app_notifications_revision', sql`${t.templateRevision} > 0`),
    check('in_app_notifications_parameters', sql`jsonb_typeof(${t.safeParameters}) = 'array'`),
    index('in_app_notifications_business_idx').on(t.companyId, t.businessId),
    index('in_app_notifications_branch_idx').on(t.companyId, t.branchId),
    index('in_app_notifications_user_idx').on(t.recipientUserId),
    index('in_app_notifications_list_idx').on(
      t.companyId,
      t.recipientUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('in_app_notifications_unread_idx')
      .on(t.companyId, t.recipientUserId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.readAt} IS NULL`),
  ],
);

export const notificationAttempts = pgTable(
  'notification_attempts',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id'),
    branchId: uuid('branch_id'),
    sourceEventId: uuid('source_event_id').notNull(),
    channel: text('channel').notNull(),
    templateKey: text('template_key').notNull(),
    templateRevision: integer('template_revision').notNull(),
    locale: text('locale'),
    providerTemplateName: text('provider_template_name'),
    // الوجهة مؤقتة حتى النتيجة النهائية؛ الهوية المشفرة تبقى لمنع إعادة الإرسال.
    recipientPhone: text('recipient_phone'),
    // البريد وجهة مؤقتة مستقلة؛ لا يُعاد بناؤه من الهوية بعد المسح.
    recipientEmail: text('recipient_email'),
    recipientHash: bytea('recipient_hash').notNull(),
    hashKeyId: text('hash_key_id').notNull(),
    phoneLast3: text('phone_last3'),
    safeParameters: jsonb('safe_parameters').notNull(),
    status: text('status').notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }).notNull(),
    sendDeadline: timestamp('send_deadline', { withTimezone: true }),
    // سياج التنفيذ غير القابل لإعادة الاستحواذ حتى عند فقدان رد COMMIT.
    executionId: uuid('execution_id'),
    sendingAt: timestamp('sending_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
    outcomeKnown: boolean('outcome_known'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'notification_attempts_pkey', columns: [t.companyId, t.id] }),
    unique('notification_attempts_identity').on(
      t.companyId,
      t.sourceEventId,
      t.channel,
      t.recipientHash,
      t.templateKey,
    ),
    foreignKey({
      name: 'notification_attempts_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'notification_attempts_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    check('notification_attempts_scope', sql`${t.branchId} IS NULL OR ${t.businessId} IS NOT NULL`),
    check(
      'notification_attempts_status',
      sql`${t.status} IN ('PENDING','SENDING','SENT','FAILED','EXPIRED','SUPPRESSED')`,
    ),
    check(
      'notification_attempts_locale',
      sql`(${t.locale} IS NOT NULL AND ${t.locale} IN ('ar','en')) OR (${t.locale} IS NULL AND ${t.status} = 'FAILED' AND ${t.failureCode} IS NOT NULL AND ${t.failureCode} IN ('LOCALE_MISSING','LOCALE_UNSUPPORTED'))`,
    ),
    check(
      'notification_attempts_phone',
      sql`(${t.status} NOT IN ('SENT','FAILED','EXPIRED','SUPPRESSED') OR ${t.recipientPhone} IS NULL) AND (${t.status} <> 'PENDING' OR ${t.channel} <> 'whatsapp' OR ${t.recipientPhone} IS NOT NULL) AND (${t.recipientPhone} IS NULL OR ${t.recipientPhone} ~ '^[+][1-9][0-9]{7,14}$') AND (${t.channel} = 'whatsapp' OR ${t.recipientPhone} IS NULL)`,
    ),
    check(
      'notification_attempts_email',
      sql`(${t.status} NOT IN ('SENT','FAILED','EXPIRED','SUPPRESSED') OR ${t.recipientEmail} IS NULL) AND (${t.status} <> 'PENDING' OR ${t.channel} <> 'email' OR ${t.recipientEmail} IS NOT NULL) AND (${t.channel} = 'email' OR ${t.recipientEmail} IS NULL) AND (${t.recipientEmail} IS NULL OR (length(${t.recipientEmail}) <= 254 AND ${t.recipientEmail} ~ '^[^[:space:]@]+@[a-z0-9.-]+[.][a-z]{2,63}$'))`,
    ),
    check(
      'notification_attempts_hash',
      sql`octet_length(${t.recipientHash}) = 32 AND ((${t.channel} = 'whatsapp' AND ${t.phoneLast3} IS NOT NULL AND ${t.phoneLast3} ~ '^[0-9]{3}$') OR (${t.channel} = 'email' AND ${t.phoneLast3} IS NULL))`,
    ),
    check('notification_attempts_revision', sql`${t.templateRevision} > 0`),
    check(
      'notification_attempts_execution',
      sql`${t.status} <> 'SENDING' OR (${t.executionId} IS NOT NULL AND ${t.sendingAt} IS NOT NULL)`,
    ),
    check(
      'notification_attempts_failure',
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('LOCALE_MISSING','LOCALE_UNSUPPORTED','DESTINATION_INVALID','CONFIG_INVALID','PARAMETERS_INVALID','ADMISSION_REFUSED','DEADLINE_EXPIRED','SUPPRESSED','PROVIDER_4XX','PROVIDER_5XX','NETWORK_UNKNOWN','RESPONSE_INVALID')`,
    ),
    check('notification_attempts_parameters', sql`jsonb_typeof(${t.safeParameters}) = 'array'`),
    check('notification_attempts_channel', sql`${t.channel} IN ('whatsapp','email')`),
    index('notification_attempts_business_idx').on(t.companyId, t.businessId),
    index('notification_attempts_branch_idx').on(t.companyId, t.branchId),
    index('notification_attempts_log_idx').on(t.companyId, t.createdAt.desc(), t.id.desc()),
    index('notification_attempts_status_idx').on(t.companyId, t.status, t.createdAt, t.id),
  ],
);
