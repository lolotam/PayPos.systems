import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses, companies } from './tenancy.ts';

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
    birthMonth: smallint('birth_month'),
    birthDay: smallint('birth_day'),
    // السنة اختيارية، فمش بنستخدم date: عمود تاريخ واحد كان هيضيع "السنة مش معروفة".
    birthYear: smallint('birth_year'),
    gender: text('gender').$type<'female' | 'male'>(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'customers_pkey', columns: [t.companyId, t.id] }),
    unique('customers_company_phone_unique').on(t.companyId, t.phone),
    check('customers_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{1,14}$'`),
    check('customers_locale', sql`${t.locale} IN ('ar', 'en')`),
    check('customers_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 200`),
    check(
      'customers_birth_month',
      sql`${t.birthMonth} IS NULL OR ${t.birthMonth} BETWEEN 1 AND 12`,
    ),
    check('customers_birth_day', sql`${t.birthDay} IS NULL OR ${t.birthDay} BETWEEN 1 AND 31`),
    check('customers_birth_year', sql`${t.birthYear} IS NULL OR ${t.birthYear} BETWEEN 1 AND 9999`),
    check('customers_gender', sql`${t.gender} IS NULL OR ${t.gender} IN ('female', 'male')`),
    check(
      'customers_email',
      sql`${t.email} IS NULL OR (${t.email} !~ '[\\u0001-\\u001F\\u007F-\\u009F]' AND char_length(${t.email}) BETWEEN 3 AND 254 AND ${t.email} = btrim(${t.email}) AND position('@' in ${t.email}) > 0 AND position('.' in ${t.email}) > 0)`,
    ),
    check(
      'customers_birthday_shape',
      sql`(${t.birthMonth} IS NULL AND ${t.birthDay} IS NULL AND ${t.birthYear} IS NULL) OR (${t.birthMonth} IS NOT NULL AND ${t.birthDay} IS NOT NULL AND ((${t.birthMonth} <> 2 OR ${t.birthDay} <= 29) AND (${t.birthMonth} NOT IN (4, 6, 9, 11) OR ${t.birthDay} <= 30) AND (NOT (${t.birthMonth} = 2 AND ${t.birthDay} = 29 AND ${t.birthYear} IS NOT NULL) OR (${t.birthYear} % 4 = 0 AND (${t.birthYear} % 100 <> 0 OR ${t.birthYear} % 400 = 0)))))`,
    ),
  ],
);

// ملاحظة العميل: وحدة لكل نشاط داخل الشركة (D-8). السطر ثابت، فمفيش updated_at ولا تعديل ولا حذف.
export const customerNotes = pgTable(
  'customer_notes',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    customerId: uuid('customer_id').notNull(),
    businessId: uuid('business_id').notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'customer_notes_pkey',
      columns: [t.companyId, t.customerId, t.businessId],
    }),
    foreignKey({
      name: 'customer_notes_customer_fk',
      columns: [t.companyId, t.customerId],
      foreignColumns: [customers.companyId, customers.id],
    }),
    foreignKey({
      name: 'customer_notes_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    index('customer_notes_business_idx').on(t.companyId, t.businessId),
    check(
      'customer_notes_note',
      sql`char_length(${t.note}) BETWEEN 1 AND 500 AND ${t.note} = btrim(${t.note})`,
    ),
  ],
);
