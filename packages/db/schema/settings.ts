import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { businesses } from './tenancy.ts';

// إعدادات النشاط (PRD P0-T10.1) — صف واحد لكل نشاط، بيتعمل أول ما حد يغيّر حاجة. كل عمود null معناه "زي الـ
// template" (قرار Waleed 2026-09-23: الـ template الأول وبعدين تعديلات العميل)، فالـ template لو اتغير بيوصل لكل نشاط
// ما غيّرش القيمة دي.
export const businessSettings = pgTable(
  'business_settings',
  {
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    defaultLanguage: text('default_language'),
    calendar: text('calendar'),
    // حد النشاط عند غياب الحد الشخصي؛ null يتركه غير مضبوط ولا يعني سلطة غير محدودة.
    limitBps: integer('limit_bps'),
    // قاعدة الـ VAT (packages/domain TaxRule) — null = مفيش ضريبة. الكويت مفيهاش النهارده، ومفيش route بيكتبها لحد
    // P2-T4 (PRD D-27).
    taxRule: jsonb('tax_rule'),
    updatedBy: uuid('updated_by').references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'business_settings_pkey', columns: [t.companyId, t.businessId] }),
    foreignKey({
      name: 'business_settings_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    check(
      'business_settings_language',
      sql`${t.defaultLanguage} IS NULL OR ${t.defaultLanguage} IN ('ar', 'en')`,
    ),
    check(
      'business_settings_calendar',
      sql`${t.calendar} IS NULL OR ${t.calendar} IN ('gregorian', 'hijri')`,
    ),
    check(
      'business_settings_limit_bps',
      sql`${t.limitBps} IS NULL OR ${t.limitBps} BETWEEN 0 AND 10000`,
    ),
    index('business_settings_updated_by_idx').on(t.updatedBy),
  ],
);
