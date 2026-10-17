import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { companies } from './tenancy.ts';

// عدّاد الرقم الوظيفي: صف واحد لكل شركة. مفتاحه هو مفتاح المستأجر نفسه (مثل companies.id)، فلا يوجد
// مفتاح id وحده يكشف تفرد صفوف شركة أخرى. كل كتابة لرقم داخل الشركة تقفل هذا الصف أولاً.
export const employeeNumberSequences = pgTable(
  'employee_number_sequences',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // أول رقم يُفحص عند الإسناد التلقائي؛ يتجاوز دائماً الأرقام المستخدمة، ويصل إلى مليون بعد آخر رقم ممكن.
    nextNumber: integer('next_number').notNull().default(1),
    // رقم البداية الذي اختاره المالك مرة واحدة؛ الأعمدة الثلاثة تحضر معاً أو تغيب معاً.
    startNumber: integer('start_number'),
    startSetBy: uuid('start_set_by').references(() => user.id),
    startSetAt: timestamp('start_set_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'employee_number_sequences_pkey', columns: [t.companyId] }),
    index('employee_number_sequences_start_set_by_idx').on(t.startSetBy),
    check('employee_number_sequences_next_range', sql`${t.nextNumber} BETWEEN 1 AND 1000000`),
    check(
      'employee_number_sequences_start_range',
      sql`${t.startNumber} IS NULL OR ${t.startNumber} BETWEEN 1 AND 999999`,
    ),
    check(
      'employee_number_sequences_start_together',
      sql`(${t.startNumber} IS NULL AND ${t.startSetBy} IS NULL AND ${t.startSetAt} IS NULL) OR (${t.startNumber} IS NOT NULL AND ${t.startSetBy} IS NOT NULL AND ${t.startSetAt} IS NOT NULL)`,
    ),
  ],
);
