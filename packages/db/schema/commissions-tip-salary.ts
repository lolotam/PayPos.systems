import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { employees } from './staff.ts';
import { branches, businesses } from './tenancy.ts';

/** رأس البقشيش يبقى حتى مع مجموعة فارغة حتى لا تعيد مراجعة قديمة الصفوف المحذوفة. */
export const commissionTipHeads = pgTable(
  'commission_tip_heads',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    // الجلسة هوية من الحدث، دون ربط بجدول تملكه orders.
    sessionId: uuid('session_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    revision: integer('revision').notNull(),
    businessDate: date('business_date').notNull(),
    period: text('period').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('commission_tip_heads_session_unique').on(t.companyId, t.sessionId),
    unique('commission_tip_heads_business_session_unique').on(
      t.companyId,
      t.businessId,
      t.sessionId,
    ),
    foreignKey({
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    check('commission_tip_heads_revision_positive', sql`${t.revision} > 0`),
    check('commission_tip_heads_period_format', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'commission_tip_heads_period_date',
      sql`${t.period} = to_char(${t.businessDate}, 'YYYY-MM')`,
    ),
    index('commission_tip_heads_branch_idx')
      .on(t.companyId, t.businessId, t.branchId)
      .concurrently(),
    index('commission_tip_heads_period_idx')
      .on(t.companyId, t.businessId, t.period, t.sessionId)
      .concurrently(),
  ],
);

/** صفوف البقشيش إسقاط قابل للاستبدال بالكامل تحت الرأس نفسه، والكاش مستقل عن الكارت. */
export const commissionTips = pgTable(
  'commission_tips',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    method: text('method').notNull(),
    amount: numeric('amount', { precision: 14, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('commission_tips_entry_unique').on(t.companyId, t.sessionId, t.employeeId, t.method),
    foreignKey({
      columns: [t.companyId, t.businessId, t.sessionId],
      foreignColumns: [
        commissionTipHeads.companyId,
        commissionTipHeads.businessId,
        commissionTipHeads.sessionId,
      ],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    check('commission_tips_method', sql`${t.method} IN ('CASH', 'CARD')`),
    check('commission_tips_amount', sql`${t.amount} BETWEEN 0 AND 99999999999.999`),
    index('commission_tips_head_idx').on(t.companyId, t.businessId, t.sessionId).concurrently(),
    index('commission_tips_employee_idx')
      .on(t.companyId, t.businessId, t.employeeId)
      .concurrently(),
  ],
);

/** راتب واحد لكل موظفة وتاريخ سريان؛ المراجعة الأحدث تغير المبلغ دون تغيير الهوية. */
export const commissionSalaries = pgTable(
  'commission_salaries',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    amount: numeric('amount', { precision: 14, scale: 3 }).notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('commission_salaries_effective_unique').on(t.companyId, t.employeeId, t.effectiveFrom),
    foreignKey({
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    check('commission_salaries_revision_positive', sql`${t.revision} > 0`),
    check('commission_salaries_amount', sql`${t.amount} BETWEEN 0 AND 99999999999.999`),
    index('commission_salaries_employee_idx')
      .on(t.companyId, t.businessId, t.employeeId, t.effectiveFrom)
      .concurrently(),
  ],
);
