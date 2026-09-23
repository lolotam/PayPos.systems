import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { branches, businesses, companies } from './tenancy.ts';

// الصلاحيات (ADR-0003 §2.2، §2.3): memberships و permission_overrides هما الـ bridge (RLS على اليوزر وعلى الشركة)،
// و permissions مرجعية عامة، و roles و role_permissions فيهم صفوف عامة (company_id NULL) وصفوف لشركة.
// الـ policies والـ grants في الـ migration المكتوبة بإيد.

// الـ owner_key بيسمّي صاحب الـ role بقيمة مش NULL، عشان الـ FK المركّب يتفحص حتى للـ roles العامة (§2.3).
const ownerKey = (companyId: SQL | unknown): SQL => sql`COALESCE(${companyId}::text, 'global')`;

const SCOPE_TYPES = sql`('COMPANY', 'BUSINESS', 'BRANCH')`;

// النطاق بيتخزن scope_type + scope_id، ومنه عمودين محسوبين عليهم FK للـ business أو الفرع في نفس الشركة —
// الـ FK بيتخطى الصف لما العمود NULL، فكل نوع بيتفحص بس لما يكون هو النوع.
const scopeColumns = () => ({
  scopeType: text('scope_type').notNull(),
  scopeId: uuid('scope_id').notNull(),
  scopeBusinessId: uuid('scope_business_id').generatedAlwaysAs(
    sql`CASE WHEN scope_type = 'BUSINESS' THEN scope_id END`,
  ),
  scopeBranchId: uuid('scope_branch_id').generatedAlwaysAs(
    sql`CASE WHEN scope_type = 'BRANCH' THEN scope_id END`,
  ),
});

// الـ catalog بتاع 'action:resource:scope' — بيتزرع من الكود (seed.ts)، والـ app بيقراه بس.
export const permissions = pgTable(
  'permissions',
  {
    code: text('code').primaryKey(),
  },
  (t) => [
    check(
      'permissions_code_format',
      sql`${t.code} ~ '^[a-z][a-z-]*:[a-z][a-z-]*:(platform|company|business|branch)$'`,
    ),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').notNull(),
    // NULL = role نظام؛ الـ roles الخاصة بشركة بتيجي في Phase 1.
    companyId: uuid('company_id').references(() => companies.id),
    ownerKey: text('owner_key')
      .notNull()
      .generatedAlwaysAs(sql`COALESCE(company_id::text, 'global')`),
    code: text('code').notNull(),
    nameAr: text('name_ar'),
    nameEn: text('name_en').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // (id, owner_key) هو اللي الـ FKs بتشاور عليه؛ مفيش unique على id لوحده (ADR-0007).
    primaryKey({ name: 'roles_pkey', columns: [t.id, t.ownerKey] }),
    unique('roles_owner_key_code_key').on(t.ownerKey, t.code),
    index('roles_company_id_idx').on(t.companyId),
    check('roles_code_format', sql`${t.code} ~ '^[a-z][a-z_]{0,63}$'`),
    check('roles_name_en_length', sql`char_length(${t.nameEn}) BETWEEN 1 AND 255`),
    check(
      'roles_name_ar_length',
      sql`${t.nameAr} IS NULL OR char_length(${t.nameAr}) BETWEEN 1 AND 255`,
    ),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    roleOwnerKey: text('role_owner_key').notNull(),
    companyId: uuid('company_id').references(() => companies.id),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code),
    // قيود على الصلاحية (حد خصم مثلاً) — بتتطبق في P2-T7، دلوقتي بتتخزن بس.
    constraints: jsonb('constraints')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    primaryKey({
      name: 'role_permissions_pkey',
      columns: [t.roleId, t.roleOwnerKey, t.permissionCode],
    }),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [t.roleId, t.roleOwnerKey],
      foreignColumns: [roles.id, roles.ownerKey],
    }).onDelete('cascade'),
    // صف بيتبع صاحب الـ role بالظبط: شركة متقدرش تزوّد صلاحية على role عام (§2.3).
    check('role_permissions_owner', sql`${t.roleOwnerKey} = ${ownerKey(t.companyId)}`),
    index('role_permissions_company_id_idx').on(t.companyId),
    index('role_permissions_permission_code_idx').on(t.permissionCode),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // صاحب العضوية واحد بس: يوزر أو موظف (بـ PIN على جهاز، T9b) — ADR-0003 §4 path B.
    userId: uuid('user_id').references(() => user.id),
    // الـ FK على staff.employees بييجي مع staff في Phase 1 (ADR-0003 §4.2).
    employeeId: uuid('employee_id'),
    roleId: uuid('role_id').notNull(),
    roleOwnerKey: text('role_owner_key').notNull(),
    ...scopeColumns(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'memberships_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'memberships_role_fk',
      columns: [t.roleId, t.roleOwnerKey],
      foreignColumns: [roles.id, roles.ownerKey],
    }),
    foreignKey({
      name: 'memberships_scope_business_fk',
      columns: [t.companyId, t.scopeBusinessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'memberships_scope_branch_fk',
      columns: [t.companyId, t.scopeBranchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    // role عام أو role بتاع نفس الشركة — مش role شركة تانية (§2.3).
    check(
      'memberships_role_owner',
      sql`${t.roleOwnerKey} = 'global' OR ${t.roleOwnerKey} = ${t.companyId}::text`,
    ),
    check('memberships_one_holder', sql`num_nonnulls(${t.userId}, ${t.employeeId}) = 1`),
    check('memberships_scope_type', sql`${t.scopeType} IN ${SCOPE_TYPES}`),
    check(
      'memberships_company_scope',
      sql`${t.scopeType} <> 'COMPANY' OR ${t.scopeId} = ${t.companyId}`,
    ),
    check('memberships_window', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    index('memberships_user_id_idx').on(t.userId),
    index('memberships_company_id_employee_id_idx').on(t.companyId, t.employeeId),
    index('memberships_role_idx').on(t.roleId, t.roleOwnerKey),
    index('memberships_scope_business_idx').on(t.companyId, t.scopeBusinessId),
    index('memberships_scope_branch_idx').on(t.companyId, t.scopeBranchId),
  ],
);

export const permissionOverrides = pgTable(
  'permission_overrides',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code),
    effect: text('effect').notNull(),
    ...scopeColumns(),
    reason: text('reason').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'permission_overrides_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'permission_overrides_membership_fk',
      columns: [t.companyId, t.membershipId],
      foreignColumns: [memberships.companyId, memberships.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'permission_overrides_scope_business_fk',
      columns: [t.companyId, t.scopeBusinessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'permission_overrides_scope_branch_fk',
      columns: [t.companyId, t.scopeBranchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    check('permission_overrides_effect', sql`${t.effect} IN ('ALLOW', 'DENY')`),
    check('permission_overrides_scope_type', sql`${t.scopeType} IN ${SCOPE_TYPES}`),
    check(
      'permission_overrides_company_scope',
      sql`${t.scopeType} <> 'COMPANY' OR ${t.scopeId} = ${t.companyId}`,
    ),
    check('permission_overrides_reason_length', sql`char_length(${t.reason}) BETWEEN 1 AND 500`),
    index('permission_overrides_membership_idx').on(t.companyId, t.membershipId),
    index('permission_overrides_permission_code_idx').on(t.permissionCode),
    index('permission_overrides_granted_by_idx').on(t.grantedBy),
    index('permission_overrides_scope_business_idx').on(t.companyId, t.scopeBusinessId),
    index('permission_overrides_scope_branch_idx').on(t.companyId, t.scopeBranchId),
  ],
);
