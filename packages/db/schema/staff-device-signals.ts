import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { employees } from './staff.ts';
import { branches } from './tenancy.ts';

export const attendanceDeviceSignals = pgTable(
  'attendance_device_signals',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // معرف صف audit لحركة المسح المقبولة (clocked_in/clocked_out) ويسمي الجلسة؛ فريد ضد تكرار الإشارة.
    clockEventId: uuid('clock_event_id').notNull(),
    // hash خاص بالشركة لمعرف تثبيت عشوائي؛ لا بصمة متصفح ولا PII.
    installationHash: text('installation_hash').notNull(),
    // قرار المالك 2026-10-04 (UNB-Q4): الإشارات تبقى مع تاريخ الحضور دون مهمة تنظيف الآن.
    clockedAt: timestamp('clocked_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'attendance_device_signals_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_device_signals_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_device_signals_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    uniqueIndex('attendance_device_signals_clock_key').on(t.companyId, t.clockEventId),
    index('attendance_device_signals_hash_time_idx').on(
      t.companyId,
      t.installationHash,
      t.clockedAt,
      t.id,
    ),
    index('attendance_device_signals_branch_time_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.clockedAt,
      t.id,
    ),
    index('attendance_device_signals_employee_idx').on(t.companyId, t.businessId, t.employeeId),
    check('attendance_device_signals_hash_format', sql`${t.installationHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
