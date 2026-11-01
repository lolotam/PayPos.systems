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
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { services } from './catalog.ts';
import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { businesses, companies } from './tenancy.ts';

/**
 * تجاوزات عمولة الخدمة للموظف: سجل تاريخي للإدخال فقط (FR-011، FR-012).
 * السطر الجديد يلغي السطر الأقدم بترتيب المحرك، ومحدش يعدّل سطر قديم.
 */
export const commissionServiceOverrides = pgTable(
  'commission_service_overrides',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    // FOLLOW_PLAN | FOLLOW_SERVICE | ZERO | PCT | FIXED — القيمة المرافقة في العمود المطابق بس.
    // FOLLOW_SERVICE نوع التجاوزات بس (CS-Q39): يرجع لقطة قاعدة الخدمة المحفوظة على سطر البيع.
    ruleKind: text('rule_kind').notNull(),
    // نسبة أساس نقط (0–10000)؛ بتتحط على نوع PCT بس.
    rulePctBps: integer('rule_pct_bps'),
    // مبلغ ثابت بالدينار بثلاث خانات عشرية؛ numeric(14,3) وما يتحوّلش لعدد عشري في TS.
    ruleFixedAmount: numeric('rule_fixed_amount', { precision: 14, scale: 3 }),
    // تاريخ بداية سريان التجاوز؛ رفض التاريخ الماضي مسؤولية الكاتب مش القيد.
    effectiveFrom: date('effective_from').notNull(),
    // وقت الحفظ جاي من الـ Clock المحقون في الكاتب؛ مفيش default في الداتابيز.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    primaryKey({ name: 'commission_service_overrides_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'commission_service_overrides_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'commission_service_overrides_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'commission_service_overrides_service_fk',
      columns: [t.companyId, t.businessId, t.serviceId],
      foreignColumns: [services.companyId, services.businessId, services.id],
    }),
    // عمود النوع مش nullable، فمقارنة الأنواع دي ما بتطلعش UNKNOWN ومفيش شكل غلط بيمر.
    check(
      'commission_service_overrides_rule_kind',
      sql`${t.ruleKind} IN ('FOLLOW_PLAN','FOLLOW_SERVICE','ZERO','PCT','FIXED')`,
    ),
    check(
      'commission_service_overrides_rule_pct_present',
      sql`(${t.ruleKind} = 'PCT') = (${t.rulePctBps} IS NOT NULL)`,
    ),
    check(
      'commission_service_overrides_rule_pct_bounds',
      sql`${t.rulePctBps} IS NULL OR ${t.rulePctBps} BETWEEN 0 AND 10000`,
    ),
    check(
      'commission_service_overrides_rule_fixed_present',
      sql`(${t.ruleKind} = 'FIXED') = (${t.ruleFixedAmount} IS NOT NULL)`,
    ),
    check(
      'commission_service_overrides_rule_fixed_nonnegative',
      sql`${t.ruleFixedAmount} IS NULL OR ${t.ruleFixedAmount} BETWEEN 0 AND 99999999999.999`,
    ),
    // الفهرس ده بيغطي اختيار السطر الحالي وترتيب القائمة، وبيغطي الـ FK بتاع الموظف.
    index('commission_service_overrides_employee_service_idx').on(
      t.companyId,
      t.businessId,
      t.employeeId,
      t.serviceId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('commission_service_overrides_service_idx').on(t.companyId, t.businessId, t.serviceId),
    index('commission_service_overrides_created_by_idx').on(t.createdBy),
  ],
);
