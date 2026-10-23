import { sql } from 'drizzle-orm';
import {
  check,
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

import { companies, branches } from './tenancy.ts';
import { employees } from './staff.ts';

// إشعار «لسه مابصمش» مرة واحدة لكل موظف وبداية شيفت؛ بلا FK للشيفت لأن حفظ الأسبوع بيستبدل صفوفه (ADR-0024).
export const attendanceNotClockedInNotices = pgTable(
  'attendance_not_clocked_in_notices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    shiftStartsAt: timestamp('shift_starts_at', { withTimezone: true }).notNull(),
    shiftEndsAt: timestamp('shift_ends_at', { withTimezone: true }).notNull(),
    alertDueAt: timestamp('alert_due_at', { withTimezone: true }).notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    recipientCount: integer('recipient_count').notNull(),
    // سطر دفتر اتكتب والقاعدة أو المفتاح العام مقفولين وقتئه: من غير إشعار (spec 060 D-B15).
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'attendance_not_clocked_in_notices_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_not_clocked_in_notices_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_not_clocked_in_notices_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    unique('attendance_not_clocked_in_notices_shift_key').on(
      t.companyId,
      t.employeeId,
      t.shiftStartsAt,
    ),
    index('attendance_not_clocked_in_notices_business_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
    ),
    index('attendance_not_clocked_in_notices_branch_idx').on(t.companyId, t.branchId),
    check('attendance_not_clocked_in_notices_recipients', sql`${t.recipientCount} >= 0`),
    check('attendance_not_clocked_in_notices_span', sql`${t.shiftEndsAt} > ${t.shiftStartsAt}`),
    check(
      'attendance_not_clocked_in_notices_suppressed',
      sql`${t.suppressedAt} IS NULL OR ${t.recipientCount} = 0`,
    ),
  ],
);

// إشعار «مارجعتش من البريك» مرة واحدة لكل موظف وبداية شيفت (BW-Q5)؛ جدول منفصل عشان مفتاح دفتر «لسه مابصمش» مايتغيرش.
export const attendanceBreakNotReturnedNotices = pgTable(
  'attendance_break_not_returned_notices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    shiftStartsAt: timestamp('shift_starts_at', { withTimezone: true }).notNull(),
    shiftEndsAt: timestamp('shift_ends_at', { withTimezone: true }).notNull(),
    breakEndsAt: timestamp('break_ends_at', { withTimezone: true }).notNull(),
    // آخر بصمة خروج جوّه البريك اللي مالهاش رجوع.
    breakOutAt: timestamp('break_out_at', { withTimezone: true }).notNull(),
    alertDueAt: timestamp('alert_due_at', { withTimezone: true }).notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    recipientCount: integer('recipient_count').notNull(),
    // سطر دفتر اتكتب والقاعدة أو المفتاح العام مقفولين وقتئه: من غير إشعار (spec 060 D-B15).
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    // نوع التنبيه اللي اتكبح فيه السطر: NOT_RETURNED أو RETURNED_OTHER_BRANCH؛ والاثنان موجودين أو لا واحد.
    suppressedKind: text('suppressed_kind'),
  },
  (t) => [
    primaryKey({
      name: 'attendance_break_not_returned_notices_pkey',
      columns: [t.companyId, t.id],
    }),
    foreignKey({
      name: 'attendance_break_not_returned_notices_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_break_not_returned_notices_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    unique('attendance_break_not_returned_notices_shift_key').on(
      t.companyId,
      t.employeeId,
      t.shiftStartsAt,
    ),
    index('attendance_break_not_returned_notices_business_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
    ),
    index('attendance_break_not_returned_notices_branch_idx').on(t.companyId, t.branchId),
    check('attendance_break_not_returned_notices_recipients', sql`${t.recipientCount} >= 0`),
    check(
      'attendance_break_not_returned_notices_span',
      sql`${t.shiftEndsAt} > ${t.shiftStartsAt} AND ${t.breakEndsAt} > ${t.shiftStartsAt} AND ${t.breakEndsAt} < ${t.shiftEndsAt}`,
    ),
    check(
      'attendance_break_not_returned_notices_suppressed',
      sql`${t.suppressedAt} IS NULL OR ${t.recipientCount} = 0`,
    ),
    check(
      'attendance_break_not_returned_notices_suppressed_kind',
      sql`${t.suppressedKind} IN ('NOT_RETURNED', 'RETURNED_OTHER_BRANCH')`,
    ),
    check(
      'attendance_break_not_returned_notices_suppressed_pair',
      sql`(${t.suppressedAt} IS NULL) = (${t.suppressedKind} IS NULL)`,
    ),
  ],
);

// دفتر «دوامك قرب يخلص»: تذكير واحد لكل موظف لكل لحظة نهاية وردية، ومفتاحه الموظف ولحظة النهاية؛
// بلا FK للشيفت لأن حفظ الأسبوع بيستبدل صفوفه (ADR-0024، SE-Q3).
export const attendanceShiftEndingNotices = pgTable(
  'attendance_shift_ending_notices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    shiftStartsAt: timestamp('shift_starts_at', { withTimezone: true }).notNull(),
    shiftEndsAt: timestamp('shift_ends_at', { withTimezone: true }).notNull(),
    // لحظة استحقاق التذكير: نهاية الوردية ناقص المهلة، ولا تسبق بداية الوردية أبداً.
    remindDueAt: timestamp('remind_due_at', { withTimezone: true }).notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    recipientCount: integer('recipient_count').notNull(),
    // سطر دفتر اتكتب والقاعدة أو المفتاح العام مقفولين وقتئه: من غير إشعار (spec 060 D-B15).
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'attendance_shift_ending_notices_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_shift_ending_notices_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_shift_ending_notices_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    unique('attendance_shift_ending_notices_shift_key').on(
      t.companyId,
      t.employeeId,
      t.shiftEndsAt,
    ),
    index('attendance_shift_ending_notices_business_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
    ),
    index('attendance_shift_ending_notices_branch_idx').on(t.companyId, t.branchId),
    check('attendance_shift_ending_notices_recipients', sql`${t.recipientCount} >= 0`),
    check('attendance_shift_ending_notices_span', sql`${t.shiftEndsAt} > ${t.shiftStartsAt}`),
    check(
      'attendance_shift_ending_notices_suppressed',
      sql`${t.suppressedAt} IS NULL OR ${t.recipientCount} = 0`,
    ),
  ],
);
