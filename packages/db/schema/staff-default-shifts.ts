import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, smallint, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { employees } from './staff.ts';
import { branches } from './tenancy.ts';
import { user } from './identity-auth.ts';

export const employeeDefaultShifts = pgTable('employee_default_shifts', {
  companyId: uuid('company_id').notNull(),
  businessId: uuid('business_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  // السبت صفر والجمعة ستة، مثل نمط الجدول الأسبوعي.
  day: smallint('day').notNull(),
  start: time('start').notNull(),
  end: time('end').notNull(),
  // البريك اختياري؛ الطرفان يغيبان أو يحضران معاً.
  breakStart: time('break_start'),
  breakEnd: time('break_end'),
  updatedBy: uuid('updated_by').notNull().references(() => user.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'employee_default_shifts_pkey', columns: [t.companyId, t.employeeId, t.branchId, t.day] }),
  foreignKey({ name: 'employee_default_shifts_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  foreignKey({ name: 'employee_default_shifts_branch_fk', columns: [t.companyId, t.businessId, t.branchId], foreignColumns: [branches.companyId, branches.businessId, branches.id] }),
  index('employee_default_shifts_company_business_branch_idx').on(t.companyId, t.businessId, t.branchId),
  index('employee_default_shifts_updated_by_idx').on(t.updatedBy),
  check('employee_default_shifts_day', sql`${t.day} BETWEEN 0 AND 6`),
  check('employee_default_shifts_break_pair', sql`(${t.breakStart} IS NULL AND ${t.breakEnd} IS NULL) OR (${t.breakStart} IS NOT NULL AND ${t.breakEnd} IS NOT NULL)`),
]);
