import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { employees } from './staff.ts';
import { branches, companies } from './tenancy.ts';

export const attendanceDeviceRefusals = pgTable(
  'attendance_device_refusals',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // صاحب الهاتف لا يسجل إلا عند رفض استخدام هاتف شخص آخر.
    holderEmployeeId: uuid('holder_employee_id'),
    step: text('step').notNull(),
    reason: text('reason').notNull(),
    // المعرف الخام لا يغادر الذاكرة؛ يحتفظ التاريخ بقيمة مفصولة بالشركة فقط.
    installationHash: text('installation_hash').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'attendance_device_refusals_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_device_refusals_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_device_refusals_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'attendance_device_refusals_holder_fk',
      columns: [t.companyId, t.holderEmployeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
    index('attendance_device_refusals_branch_time_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.attemptedAt,
      t.id,
    ),
    index('attendance_device_refusals_employee_idx').on(t.companyId, t.businessId, t.employeeId),
    index('attendance_device_refusals_holder_idx')
      .on(t.companyId, t.holderEmployeeId)
      .where(sql`${t.holderEmployeeId} IS NOT NULL`),
    check('attendance_device_refusals_step', sql`${t.step} IN ('CHALLENGE','CLOCK','ENROL')`),
    check(
      'attendance_device_refusals_reason',
      sql`${t.reason} IN ('DEVICE_LOCKED','NOT_ENROLLED','DEVICE_TAKEN','OTHER_DEVICE')`,
    ),
    check(
      'attendance_device_refusals_holder_reason',
      sql`(${t.holderEmployeeId} IS NOT NULL) = (${t.reason} IN ('DEVICE_LOCKED','DEVICE_TAKEN'))`,
    ),
    check('attendance_device_refusals_hash_format', sql`${t.installationHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
