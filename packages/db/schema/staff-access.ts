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
  uniqueIndex,
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
    // هوية المحاولة الحالية: تتجدد عند إنشاء السجل وعند كل إعادة منح من STOPPED، فلا ينهي طلب
    // قديم محاولة أحدث على نفس السجل (operation_id يبقى ثابتاً لحساب auth فقط).
    attemptId: uuid('attempt_id').notNull(),
    // لحظة بداية محاولة PENDING الحالية من الساعة المحقونة — قاعدة الـ 24 ساعة للإلغاء تُقاس منها لا من created_at.
    attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }).notNull().defaultNow(),
    // hash الهاتف المطلوب عند إنشاء السجل — الاستئناف بيرفض أي هاتف مختلف بلا كشف الهاتف.
    phoneHash: text('phone_hash').notNull(),
    // PENDING قبل الإتمام، ACTIVE بعد المعاملة الثالثة، STOPPED بعد «إيقاف الدخول» (F3)،
    // CANCELLING بين بدء الإلغاء وحذف الحساب — أي منح أو استئناف يرفض السجل في الحالة دي.
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
    // مفتاح هوية مركّب (080-b): الجدول الفرعي employee_staff_access_branches بيعتمد عليه في قيده
    // المركّب، فمحتاج قيد فريد على نفس الأعمدة بالترتيب ده.
    unique('employee_staff_access_identity_key').on(t.companyId, t.id, t.businessId, t.employeeId),
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
    // فهارس FK المركّبة: مسار قراءة الحالة والانتهاز عبر الفرع، والإلغاء/الإيقاف عبر العضوية.
    index('employee_staff_access_branch_idx').on(t.companyId, t.businessId, t.branchId),
    index('employee_staff_access_membership_idx').on(t.companyId, t.membershipId),
    check(
      'employee_staff_access_role_code',
      sql`${t.roleCode} IN ('staff', 'reception')`,
    ),
    check(
      'employee_staff_access_state',
      sql`${t.state} IN ('PENDING', 'ACTIVE', 'STOPPED', 'PHONE_CHANGING', 'CANCELLING')`,
    ),
    check(
      'employee_staff_access_active_rows',
      sql`${t.state} <> 'ACTIVE' OR (${t.userId} IS NOT NULL AND ${t.membershipId} IS NOT NULL)`,
    ),
  ],
);

// الفروع الإضافية لدخول الموظفة (080-b): السجل الأساسي في employee_staff_access والجدول الفرعي ده
// صف لكل فرع زيادة بدوره الخاص. عضويات الفروع الإضافية بتنشأ وقت التفعيل وتحفظ في membership_id؛
// NULL معناها لسه PENDING أو اتوقّف. tenant table بـ RLS إجباري زي أي جدول شركة.
export const employeeStaffAccessBranches = pgTable(
  'employee_staff_access_branches',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // النشاط من السجل الأصلي — مرجع القيد المركّب مع الموظفة.
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // السجل الأصلي اللي بيحكم الصف ده.
    accessId: uuid('access_id').notNull(),
    // الفرع الإضافي ودوره في الدخول ('staff' | 'reception').
    branchId: uuid('branch_id').notNull(),
    roleCode: text('role_code').notNull(),
    // العضوية اللي اتعملت للفرع الإضافي؛ NULL قبل التفعيل وبعد الإيقاف.
    membershipId: uuid('membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'employee_staff_access_branches_pkey', columns: [t.companyId, t.id] }),
    unique('employee_staff_access_branches_access_branch_key').on(t.companyId, t.accessId, t.branchId),
    foreignKey({
      name: 'employee_staff_access_branches_access_fk',
      columns: [t.companyId, t.accessId, t.businessId, t.employeeId],
      foreignColumns: [
        employeeStaffAccess.companyId,
        employeeStaffAccess.id,
        employeeStaffAccess.businessId,
        employeeStaffAccess.employeeId,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'employee_staff_access_branches_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'employee_staff_access_branches_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'employee_staff_access_branches_membership_fk',
      columns: [t.companyId, t.membershipId],
      foreignColumns: [memberships.companyId, memberships.id],
    }),
    index('employee_staff_access_branches_employee_idx').on(t.companyId, t.employeeId),
    index('employee_staff_access_branches_branch_idx').on(t.companyId, t.businessId, t.branchId),
    // عضوية واحدة بس لكل فرع إضافي: نفس العضوية ما تتكررش على فرعين.
    uniqueIndex('employee_staff_access_branches_membership_uidx')
      .on(t.companyId, t.membershipId)
      .where(sql`${t.membershipId} IS NOT NULL`),
    check(
      'employee_staff_access_branches_role_code',
      sql`${t.roleCode} IN ('staff', 'reception')`,
    ),
  ],
);
