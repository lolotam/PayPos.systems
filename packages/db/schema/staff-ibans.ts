import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

export const employeeIbans = pgTable(
  'employee_ibans',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // أعلى نسخة هي الحساب الحالي؛ المسح يضيف نسخة ولا يعدّل التاريخ.
    revision: integer('revision').notNull(),
    // غياب الحقول المصرفية الثلاثة معاً يسجل مسح الحساب.
    iban: text('iban'),
    // معرّف ثابت من قائمة البنوك المرجعية داخل النطاق.
    bankId: text('bank_id'),
    holderNameEn: text('holder_name_en'),
    setBy: uuid('set_by')
      .notNull()
      .references(() => user.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'employee_ibans_pkey', columns: [t.companyId, t.id] }),
    unique('employee_ibans_employee_revision_key').on(t.companyId, t.employeeId, t.revision),
    foreignKey({
      name: 'employee_ibans_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    index('employee_ibans_company_business_idx').on(t.companyId, t.businessId),
    index('employee_ibans_set_by_idx').on(t.setBy),
    index('employee_ibans_company_iban_idx')
      .on(t.companyId, t.iban)
      .where(sql`${t.iban} IS NOT NULL`),
    check('employee_ibans_revision_positive', sql`${t.revision} > 0`),
    check(
      'employee_ibans_fields_together',
      sql`(${t.iban} IS NULL AND ${t.bankId} IS NULL AND ${t.holderNameEn} IS NULL) OR (${t.iban} IS NOT NULL AND ${t.bankId} IS NOT NULL AND ${t.holderNameEn} IS NOT NULL)`,
    ),
    check(
      'employee_ibans_iban_shape',
      sql`${t.iban} ~ '^(KW[0-9]{2}[A-Z]{4}[A-Z0-9]{22}|SA[0-9]{4}[A-Z0-9]{18}|AE[0-9]{21}|BH[0-9]{2}[A-Z]{4}[A-Z0-9]{14}|QA[0-9]{2}[A-Z]{4}[A-Z0-9]{21}|OM[0-9]{5}[A-Z0-9]{16})$'`,
    ),
    check('employee_ibans_bank_shape', sql`${t.bankId} ~ '^[a-z]{2}-[a-z0-9-]{1,40}$'`),
    check('employee_ibans_bank_country', sql`left(${t.bankId},2) = lower(left(${t.iban},2))`),
    check(
      'employee_ibans_holder_length',
      sql`char_length(trim(${t.holderNameEn})) BETWEEN 1 AND 100`,
    ),
    check('employee_ibans_reason_length', sql`char_length(trim(${t.reason})) BETWEEN 1 AND 500`),
  ],
);
