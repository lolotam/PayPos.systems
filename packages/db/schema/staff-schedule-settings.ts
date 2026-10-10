import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';
import { branches, businesses } from './tenancy.ts';

export const staffScheduleSettings = pgTable(
  'staff_schedule_settings',
  {
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    // حد النشاط الموروث للفروع دون قيمة خاصة؛ غياب الصف يعني ثلاث ورديات.
    maxShiftsPerDay: smallint('max_shifts_per_day').notNull(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'staff_schedule_settings_pkey', columns: [t.companyId, t.businessId] }),
    foreignKey({
      name: 'staff_schedule_settings_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    check('staff_schedule_settings_max_shifts_per_day', sql`${t.maxShiftsPerDay} BETWEEN 1 AND 4`),
    index('staff_schedule_settings_updated_by_idx').on(t.updatedBy),
  ],
);

export const staffBranchScheduleSettings = pgTable(
  'staff_branch_schedule_settings',
  {
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    // حد ورديات الموظف في هذا الفرع حسب يوم البداية؛ حذف الصف يعيد حد النشاط.
    maxShiftsPerDay: smallint('max_shifts_per_day').notNull(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'staff_branch_schedule_settings_pkey', columns: [t.companyId, t.branchId] }),
    foreignKey({
      name: 'staff_branch_schedule_settings_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    check(
      'staff_branch_schedule_settings_max_shifts_per_day',
      sql`${t.maxShiftsPerDay} BETWEEN 1 AND 4`,
    ),
    index('staff_branch_schedule_settings_company_business_idx').on(t.companyId, t.businessId),
    index('staff_branch_schedule_settings_updated_by_idx').on(t.updatedBy),
  ],
);
