import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
import { companies, businesses, branches } from './tenancy.ts';
import { employees } from './staff.ts';

export const staffSchedules = pgTable(
  'staff_schedules',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    weekStart: date('week_start').notNull(),
    // المنطقة المستخدمة عند الحفظ تثبت معنى الأوقات المحلية حتى لو تغير إعداد الفرع لاحقاً.
    timezone: text('timezone').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('staff_schedules_week_key').on(t.companyId, t.employeeId, t.branchId, t.weekStart),
    unique('staff_schedules_employee_key').on(t.companyId, t.id, t.employeeId),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    index('staff_schedules_branch_week_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.weekStart,
      t.employeeId,
    ),
    check('staff_schedules_saturday', sql`extract(dow from ${t.weekStart}) = 6`),
    check('staff_schedules_revision', sql`${t.revision} > 0`),
  ],
);
export const staffScheduleShifts = pgTable(
  'staff_schedule_shifts',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    scheduleId: uuid('schedule_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // يوم البداية هو working_date حتى لو انتهت الوردية بعد منتصف الليل.
    workingDate: date('working_date').notNull(),
    day: integer('day').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // البريك ينسب ليوم بداية الوردية ويحسب ضمن وقت العمل حتى بعد منتصف الليل.
    breakStart: text('break_start'),
    breakEnd: text('break_end'),
    breakStartsAt: timestamp('break_starts_at', { withTimezone: true }),
    breakEndsAt: timestamp('break_ends_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    foreignKey({
      columns: [t.companyId, t.scheduleId, t.employeeId],
      foreignColumns: [staffSchedules.companyId, staffSchedules.id, staffSchedules.employeeId],
    }),
    index('staff_schedule_shifts_schedule_idx').on(t.companyId, t.scheduleId, t.startsAt),
    index('staff_schedule_shifts_employee_idx').on(t.companyId, t.employeeId, t.startsAt),
    index('staff_schedule_shifts_company_starts_idx').on(t.companyId, t.startsAt),
    check(
      'staff_schedule_shifts_duration',
      sql`${t.endsAt} > ${t.startsAt} AND ${t.endsAt} <= ${t.startsAt} + interval '16 hours'`,
    ),
    check('staff_schedule_shifts_day', sql`${t.day} BETWEEN 0 AND 6`),
    check(
      'staff_schedule_shifts_break_pair',
      sql`(${t.breakStart} IS NULL AND ${t.breakEnd} IS NULL AND ${t.breakStartsAt} IS NULL AND ${t.breakEndsAt} IS NULL) OR (${t.breakStart} IS NOT NULL AND ${t.breakEnd} IS NOT NULL AND ${t.breakStartsAt} IS NOT NULL AND ${t.breakEndsAt} IS NOT NULL)`,
    ),
    check(
      'staff_schedule_shifts_break_inside',
      sql`${t.breakStartsAt} IS NULL OR (${t.breakStartsAt} > ${t.startsAt} AND ${t.breakEndsAt} > ${t.breakStartsAt} AND ${t.breakEndsAt} < ${t.endsAt})`,
    ),
  ],
);
export const staffShiftTemplates = pgTable(
  'staff_shift_templates',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    shifts: jsonb('shifts').notNull(),
    revision: integer('revision').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    foreignKey({
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    index('staff_shift_templates_business_idx').on(t.companyId, t.businessId, t.id),
    check('staff_shift_templates_revision', sql`${t.revision} > 0`),
  ],
);
