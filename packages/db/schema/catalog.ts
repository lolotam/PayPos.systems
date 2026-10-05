import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses, companies } from './tenancy.ts';

// خدمات النشاط: الاسم والسعر وقاعدة العمولة وراية احتسابها في المجمّع.
// الـ RLS والـ FORCE والـ grants في migration مكتوبة بإيد (drizzle-kit مبيعرفش FORCE ROW LEVEL SECURITY).
// قاعدة العمولة متخزنة أعمدة متسقة مش رقم JSON: نسبة bps عدد صحيح، والمبلغ الثابت numeric(14,3)،
// عشان "المال مبيبقاش number" يفضل صحيح والقاعدة المشوّهة مستحيل توجد.
export const services = pgTable(
  'services',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    // السعر بالدينار الكويتي بـ 3 خانات عشرية؛ مش رقم عشري في TS أبداً.
    price: numeric('price', { precision: 14, scale: 3 }).notNull(),
    /** FOLLOW_PLAN | ZERO | PCT | FIXED — القيمة المرافقة في العمود المطابق فقط. */
    commissionRuleKind: text('commission_rule_kind').notNull(),
    // نسبة أساس نقط (0–10000)؛ مش وحدات Percentage (0–100 بمقياس).
    commissionPctBps: integer('commission_pct_bps'),
    // مبلغ ثابت بالفلس؛ الفارق عن سعر الخدمة إنه كسب للموظفة مش تحصيل.
    commissionFixedAmount: numeric('commission_fixed_amount', { precision: 14, scale: 3 }),
    // افتراضي إن الخدمة بتتقدّم مجمّع الشرائح؛ المالك يقدر يستثنيها.
    countsTowardThreshold: boolean('counts_toward_threshold').notNull().default(true),
    // عداد تعديل يمنع مديرين من الكتابة فوق نفس النسخة (زي employees).
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'services_pkey', columns: [t.companyId, t.id] }),
    unique('services_company_business_id_key').on(t.companyId, t.businessId, t.id),
    foreignKey({
      name: 'services_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    index('services_company_business_id_idx').on(t.companyId, t.businessId, t.id),
    check('services_name_en_length', sql`char_length(trim(${t.nameEn})) BETWEEN 1 AND 255`),
    check(
      'services_name_ar_length',
      sql`${t.nameAr} IS NULL OR char_length(trim(${t.nameAr})) BETWEEN 1 AND 255`,
    ),
    check('services_price_nonnegative', sql`${t.price} >= 0`),
    check(
      'services_rule_kind',
      sql`${t.commissionRuleKind} IN ('FOLLOW_PLAN','ZERO','PCT','FIXED')`,
    ),
    check(
      'services_rule_pct_present',
      sql`(${t.commissionRuleKind} = 'PCT') = (${t.commissionPctBps} IS NOT NULL)`,
    ),
    check(
      'services_rule_pct_bounds',
      sql`${t.commissionPctBps} IS NULL OR ${t.commissionPctBps} BETWEEN 0 AND 10000`,
    ),
    check(
      'services_rule_fixed_present',
      sql`(${t.commissionRuleKind} = 'FIXED') = (${t.commissionFixedAmount} IS NOT NULL)`,
    ),
    check(
      'services_rule_fixed_nonnegative',
      sql`${t.commissionFixedAmount} IS NULL OR ${t.commissionFixedAmount} >= 0`,
    ),
    check('services_revision_positive', sql`${t.revision} > 0`),
  ],
);
