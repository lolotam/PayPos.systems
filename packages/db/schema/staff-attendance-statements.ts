import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches, businesses, companies } from './tenancy.ts';
import { employees } from './staff.ts';
import { user } from './identity-auth.ts';

// سجل طلب كشف الحضور الرسمي؛ الصف بيتسجل مرة واحدة وقت الطلب وما بيتعدّلش ولا بيتحذفش (ADR-0056 §5).
export const attendanceStatementRequests = pgTable(
  'attendance_statement_requests',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    form: text('form').notNull(),
    employeeId: uuid('employee_id'),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    language: text('language').notNull(),
    shiftStart: time('shift_start'),
    shiftEnd: time('shift_end'),
    // قرار الشعار وقت الطلب مش مرجع لملف: تقادم الملف أو تنقيته ما يتمنعش بطلب قديم (ADR-0056 §5).
    logoFileId: uuid('logo_file_id'),
    // طلب البيان مربوط بالمستخدم اللي طلبه؛ ربط الحالة والتحميل بيقارنوا نفس المستخدم (FR-005).
    requestedBy: uuid('requested_by').notNull().references(() => user.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'attendance_statement_requests_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_statement_requests_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'attendance_statement_requests_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'attendance_statement_requests_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    index('attendance_statement_requests_business_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.requestedAt,
    ),
    index('attendance_statement_requests_employee_idx').on(
      t.companyId,
      t.businessId,
      t.employeeId,
    ),
    index('attendance_statement_requests_requester_idx').on(
      t.companyId,
      t.requestedBy,
      t.requestedAt,
    ),
    index('attendance_statement_requests_requested_by_idx').on(t.requestedBy),
    check('attendance_statement_requests_form', sql`${t.form} IN ('BRANCH','EMPLOYEE')`),
    check('attendance_statement_requests_language', sql`${t.language} IN ('ar','en')`),
    check(
      'attendance_statement_requests_period',
      sql`${t.periodFrom} <= ${t.periodTo} AND ${t.periodTo} - ${t.periodFrom} <= 365`,
    ),
    check(
      'attendance_statement_requests_employee',
      sql`${t.form} <> 'EMPLOYEE' OR ${t.employeeId} IS NOT NULL`,
    ),
    check(
      'attendance_statement_requests_shift',
      sql`(${t.shiftStart} IS NULL) = (${t.shiftEnd} IS NULL) AND (${t.shiftStart} IS NULL OR ${t.form} = 'BRANCH')`,
    ),
  ],
);
