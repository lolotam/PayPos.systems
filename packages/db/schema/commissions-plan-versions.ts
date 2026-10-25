import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { businesses, companies } from './tenancy.ts';

export const commissionPlanVersions = pgTable(
  'commission_plan_versions',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // تسلسل مستقل لكل موظف؛ الإصدار الأعلى هو الأحدث في سجل الخطة.
    version: integer('version').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    // إعادة تسعير الشهر كله بدلاً من الاكتفاء بالأيام التي تلي تاريخ البداية.
    wholePeriod: boolean('whole_period').notNull().default(false),
    // شهر الإصلاح الوحيد الذي تطبق عليه النسخة عند معالجة خطة مفقودة.
    repairPeriod: char('repair_period', { length: 7 }),
    // لقطة الخطة الكاملة كما يفهمها محرك العمولة، لا قواعد مشتقة في قاعدة البيانات.
    plan: jsonb('plan').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    primaryKey({ name: 'commission_plan_versions_pkey', columns: [t.companyId, t.id] }),
    unique('commission_plan_versions_version_key').on(t.companyId, t.employeeId, t.version),
    foreignKey({
      name: 'commission_plan_versions_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'commission_plan_versions_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    check('commission_plan_versions_version', sql`${t.version} >= 1`),
    check(
      'commission_plan_versions_whole_or_repair',
      sql`NOT (${t.wholePeriod} AND ${t.repairPeriod} IS NOT NULL)`,
    ),
    check(
      'commission_plan_versions_repair_period',
      sql`${t.repairPeriod} IS NULL OR (${t.repairPeriod} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr(${t.repairPeriod},1,4) <> '0000')`,
    ),
    check('commission_plan_versions_plan_object', sql`jsonb_typeof(${t.plan}) = 'object'`),
    index('commission_plan_versions_employee_idx').on(
      t.companyId,
      t.businessId,
      t.employeeId,
      t.version,
    ),
    index('commission_plan_versions_created_by_idx').on(t.createdBy),
  ],
);
