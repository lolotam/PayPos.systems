import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { memberships } from './identity-access.ts';
import { employees } from './staff.ts';
import { branches, businesses, companies } from './tenancy.ts';

// سجل «إعطاء الدخول» لموظفة (spec 076 F1، BR-1): سجل واحد لكل موظفة مدى الحياة هو اللي بدير عضوية
// واحدة بعنوانها، وحساب الدخول بيتعلم أو يتلمس بمعرّف العملية بتاعه. tenant table بـ RLS إجباري
// زي أي جدول شركة، والـ policies والـ grants في الـ migration المكتوبة بإيد.

export const employeeStaffAccess = pgTable(
  'employee_staff_access',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    // الموظفة صاحبة السجل: فريد داخل الشركة — سجل واحد مدى الحياة (BR-1).
    employeeId: uuid('employee_id').notNull(),
    // هوية الاستئناف (FR-F1-6): الخطوة الثانية على pospay_auth بتلاقي الحساب أو بتتعلم بيه.
    operationId: uuid('operation_id').notNull(),
    // المستخدم بعد تأكيد الخطوة الثانية؛ NULL يعني السجل لسه PENDING قبل إنشاء الحساب.
    userId: uuid('user_id').references(() => user.id),
    // العضوية اللي السجل بيدерها؛ كل تغيير لاحق بيتناول بهذا المعرّف (BR-1).
    membershipId: uuid('membership_id'),
    // دور الطلب المقفول ('staff' | 'reception') — دور النظام الفعلي بيتحسم في identity.
    roleCode: text('role_code').notNull(),
    branchId: uuid('branch_id').notNull(),
    // PENDING قبل الإتمام، ACTIVE بعد المعاملة الثالثة، STOPPED بعد «إيقاف الدخول» (F3).
    state: text('state').notNull(),
    // المانح اللي فتح السجل — تدقيق الجدول إضافي، والسجل الكامل في audit_log.
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'employee_staff_access_pkey', columns: [t.companyId, t.id] }),
    unique('employee_staff_access_employee').on(t.companyId, t.employeeId),
    unique('employee_staff_access_operation').on(t.companyId, t.operationId),
    foreignKey({
      name: 'employee_staff_access_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'employee_staff_access_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'employee_staff_access_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'employee_staff_access_membership_fk',
      columns: [t.companyId, t.membershipId],
      foreignColumns: [memberships.companyId, memberships.id],
    }),
    index('employee_staff_access_company_idx').on(t.companyId),
    index('employee_staff_access_user_idx').on(t.userId),
    index('employee_staff_access_granted_by_idx').on(t.grantedBy),
    check(
      'employee_staff_access_role_code',
      sql`${t.roleCode} IN ('staff', 'reception')`,
    ),
    check(
      'employee_staff_access_state',
      sql`${t.state} IN ('PENDING', 'ACTIVE', 'STOPPED', 'PHONE_CHANGING')`,
    ),
    check(
      'employee_staff_access_active_rows',
      sql`${t.state} <> 'ACTIVE' OR (${t.userId} IS NOT NULL AND ${t.membershipId} IS NOT NULL)`,
    ),
  ],
);
