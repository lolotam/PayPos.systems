import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { branches, businesses, companies } from './tenancy.ts';

export const employees = pgTable(
  'employees',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    primaryBranchId: uuid('primary_branch_id').notNull(),
    userId: uuid('user_id').references(() => user.id),
    nameAr: text('name_ar'),
    nameEn: text('name_en').notNull(),
    // بيانات الوظيفة فقط؛ صلاحية الدخول مصدرها memberships ولا ينشئها هذا السجل.
    roleCode: text('role_code').notNull(),
    hireDate: date('hire_date').notNull(),
    contractEnd: date('contract_end'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // عداد تعديل الموارد البشرية يمنع مديرين من الكتابة فوق نفس النسخة.
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'employees_pkey', columns: [t.companyId, t.id] }),
    check('employees_revision_positive', sql`${t.revision} > 0`),
    unique('employees_company_business_id_key').on(t.companyId, t.businessId, t.id),
    foreignKey({
      name: 'employees_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'employees_primary_branch_fk',
      columns: [t.companyId, t.businessId, t.primaryBranchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    index('employees_company_business_id_idx').on(t.companyId, t.businessId, t.id),
    index('employees_company_primary_branch_idx').on(t.companyId, t.primaryBranchId, t.id),
    index('employees_company_user_idx').on(t.companyId, t.userId, t.businessId),
    index('employees_user_id_idx').on(t.userId),
    // قرار المالك 2026-10-03: المستخدم قد يعمل في أنشطة مختلفة، لكن له موظف نشط واحد فقط داخل النشاط.
    uniqueIndex('employees_active_user_business_key')
      .on(t.companyId, t.businessId, t.userId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.userId} IS NOT NULL`),
    check('employees_name_en_length', sql`char_length(trim(${t.nameEn})) BETWEEN 1 AND 255`),
    check(
      'employees_name_ar_length',
      sql`${t.nameAr} IS NULL OR char_length(trim(${t.nameAr})) BETWEEN 1 AND 255`,
    ),
    check(
      'employees_role_code',
      sql`${t.roleCode} IN ('owner','general_manager','accountant','business_manager','branch_manager','shift_supervisor','cashier','waiter','kitchen','storekeeper','staff','marketing','viewer')`,
    ),
  ],
);

export const employeeBranches = pgTable(
  'employee_branches',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    // تواريخ عمل محلية، لا لحظات UTC؛ أول ارتباط يبدأ من hire_date.
    from: date('from').notNull(),
    to: date('to'),
  },
  (t) => [
    primaryKey({ name: 'employee_branches_pkey', columns: [t.companyId, t.id] }),
    check('employee_branches_nonempty_interval', sql`${t.to} IS NULL OR ${t.to} > ${t.from}`),
    // GiST exclusion قيد SQL في migration employee-branch-intervals؛ Drizzle لا يمثل استبعاد تقاطع الفترات.
    uniqueIndex('employee_branches_active_key')
      .on(t.companyId, t.employeeId, t.branchId)
      .where(sql`${t.to} IS NULL`),
    foreignKey({
      name: 'employee_branches_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'employee_branches_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    index('employee_branches_company_employee_from_idx').on(t.companyId, t.employeeId, t.from),
    index('employee_branches_company_branch_from_idx').on(t.companyId, t.branchId, t.from),
    index('employee_branches_company_business_idx').on(t.companyId, t.businessId),
  ],
);
