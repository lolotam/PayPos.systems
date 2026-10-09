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
import { businesses } from './tenancy.ts';

export const staffScheduleSettings = pgTable(
  'staff_schedule_settings',
  {
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    // الحد لكل موظف حسب يوم بداية الوردية عبر فروع النشاط؛ غياب الصف يعني ثلاث ورديات.
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
