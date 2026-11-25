import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const operationalRecoveryFlagsColumns = {
  // UUID v7 من مولّد الـ ids المحقون؛ مفيش افتراضي في القاعدة (ADR-0054 §2).
  id: uuid('id').primaryKey(),
  // كود الحادثة، مثل COMMISSION_REMINDER_SCHEDULES_LOST.
  code: text('code').notNull(),
  // وقت رفع العلامة.
  raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
  // وقت المسح؛ بتحدده دالة الاستعادة وحدها.
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  // هوية من مسح العلامة.
  clearedBy: uuid('cleared_by'),
};

type FlagSelf = BuildExtraConfigColumns<string, typeof operationalRecoveryFlagsColumns, 'pg'>;

const flagChecks = (t: FlagSelf) => [
  check('operational_recovery_flags_code', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,99}$'`),
  // العلامة يا مفتوحة يا ممسوحة بشخص؛ مفيش حالة نصية.
  check(
    'operational_recovery_flags_cleared_pair',
    sql`(${t.clearedAt} IS NULL) = (${t.clearedBy} IS NULL)`,
  ),
];

/**
 * سجل الأعلام التشغيلية: جدول عام بلا `company_id` وبلا RLS (ADR-0054 §2، ADR-0061 §1).
 * مفتوح واحد لكل كود؛ أي دور تشغيل يقدر يرفع علامة، وما فيش دور تشغيل يقدر يمسحها.
 */
export const operationalRecoveryFlags = pgTable(
  'operational_recovery_flags',
  operationalRecoveryFlagsColumns,
  (t) => [
    ...flagChecks(t),
    // علامة مفتوحة واحدة لكل كود: القيد الجزئي على الأكواد غير الممسوحة بس.
    uniqueIndex('operational_recovery_flags_open_code_idx')
      .on(t.code)
      .where(sql`${t.clearedAt} IS NULL`),
  ],
);
