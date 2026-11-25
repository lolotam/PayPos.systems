import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses, companies } from './tenancy.ts';
import { commissionStatements } from './commissions-statements.ts';

const commissionStatementRemindersColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  // نوع التذكير: مراجعة اليوم الثالث أو اعتماد اليوم الثالث أو اعتماد اليوم الخامس.
  kind: text('kind').notNull(),
  // تاريخ التذكير بالتوقيت المحلي للنشاط.
  reminderDate: date('reminder_date').notNull(),
  // عدد المستلمين في مجموعة التذكير؛ صفر يعني إن المستلمين اتحسبوا في مجموعة تانية.
  recipientCount: integer('recipient_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type ReminderSelf = BuildExtraConfigColumns<
  string,
  typeof commissionStatementRemindersColumns,
  'pg'
>;

const reminderKeys = (t: ReminderSelf) => [
  primaryKey({ name: 'commission_statement_reminders_pkey', columns: [t.companyId, t.id] }),
  unique('commission_statement_reminders_once_key').on(
    t.companyId,
    t.statementId,
    t.kind,
    t.reminderDate,
  ),
];

const reminderRelations = (t: ReminderSelf) => [
  foreignKey({
    name: 'commission_statement_reminders_statement_fk',
    columns: [t.companyId, t.businessId, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_statement_reminders_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
];

const reminderChecks = (t: ReminderSelf) => [
  check(
    'commission_statement_reminders_kind',
    sql`${t.kind} IN ('REVIEW_DAY3','APPROVAL_DAY3','APPROVAL_DAY5')`,
  ),
  check('commission_statement_reminders_recipient_count', sql`${t.recipientCount} >= 0`),
];

const reminderIndexes = (t: ReminderSelf) => [
  index('commission_statement_reminders_statement_idx').on(
    t.companyId,
    t.businessId,
    t.statementId,
  ),
  index('commission_statement_reminders_date_idx').on(t.companyId, t.reminderDate),
];

/**
 * سجل تذكيرات كشف العمولة: صف لكل تذكير اترسل لكشف ونشاط وتاريخ ونوع (FR-055).
 * جدول مستأجر (RLS مفروض) للإضافة بس: مفيش UPDATE ولا DELETE لأي دور.
 */
export const commissionStatementReminders = pgTable(
  'commission_statement_reminders',
  commissionStatementRemindersColumns,
  (t) => [...reminderKeys(t), ...reminderRelations(t), ...reminderChecks(t), ...reminderIndexes(t)],
);
