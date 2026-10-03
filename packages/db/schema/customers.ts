import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { companies } from './tenancy.ts';

// هوية العميل على مستوى الشركة، لأن نفس الشخص يزور أكثر من نشاط (D-30).
// قرار المالك 2026-10-03: الأرشفة المستقبلية تستعيد نفس الهوية؛ يظل الهاتف فريداً حتى بعد الأرشفة.
export const customers = pgTable(
  'customers',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    locale: text('locale').$type<'ar' | 'en'>().notNull(),
    // وجود التاريخ يمنع طلب التقييم؛ البحث عن العميل لا يلغي اختياره.
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'customers_pkey', columns: [t.companyId, t.id] }),
    unique('customers_company_phone_unique').on(t.companyId, t.phone),
    check('customers_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{1,14}$'`),
    check('customers_locale', sql`${t.locale} IN ('ar', 'en')`),
    check('customers_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 200`),
  ],
);
