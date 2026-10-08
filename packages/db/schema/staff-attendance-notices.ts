import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
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
  ],
);
