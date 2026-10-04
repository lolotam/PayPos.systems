import { sql, type SQL } from 'drizzle-orm';
import { OWNER_ROLE_ID, PERMISSIONS, SYSTEM_ROLES, type Permission } from './access-catalog.ts';
import { ROLE_DEFAULTS, OWNER_DERIVED_PERMISSIONS, SCHEDULE_PERMISSIONS } from './role-defaults.ts';

// spec 009 يجعل الأدوار المحذوفة من الصف ❌؛ الجهاز لا يرث سلطة موظف من ALLOW قديم.
const deviceForbidden = [
  'read:passkeys:branch',
  'unbind:passkeys:branch',
  ...OWNER_DERIVED_PERMISSIONS,
  ...SCHEDULE_PERMISSIONS,
  'read:memberships:company',
  'manage:memberships:company',
  'read:memberships:business',
  'manage:memberships:business',
  'read:businesses:company',
  'create:businesses:company',
  'create:branches:business',
  'read:branches:branch',
  'manage:devices:branch',
  'read:settings:business',
  'manage:settings:business',
  'view:notifications:business',
  'create:companies:platform',
  'read:files:business',
  'manage:files:business',
  'manage:employees:business',
  'create:customers:company',
  'create:customers:business',
  'create:customers:branch',
  'manage:discounts:company',
  'manage:discount-limits:business',
] as const satisfies readonly Permission[];

const optional: Readonly<Record<string, readonly string[]>> = {
  business_manager: ['read:memberships:business', 'manage:memberships:business'],
  branch_manager: ['read:settings:business', 'manage:settings:business'],
  cashier: ['login:staff:branch'],
  // قرار المالك 2026-10-04: هذه الأدوار تقبل إنشاء العميل للشركة بتفويض شخصي فقط.
  shift_supervisor: ['create:customers:company'],
  accountant: ['create:customers:company'],
  waiter: ['create:customers:company'],
  kitchen: ['create:customers:company'],
  storekeeper: ['create:customers:company'],
  staff: ['create:customers:company'],
  marketing: ['create:customers:company'],
  viewer: ['create:customers:company'],
};

/** المرجع يميز الدور العالمي الثابت ويمنع تفويض خانات الجهاز المحظورة؛ اسم الدور المخصص لا يرث حمايته. */
export function systemRolePolicy(roleId: string, ownerKey: string) {
  const role = SYSTEM_ROLES.find((r) => r.id === roleId);
  if (ownerKey !== 'global' || role === undefined) return null;
  return {
    code: role.code,
    permissions: PERMISSIONS.filter((code) =>
      role.code === 'device'
        ? !(deviceForbidden as readonly string[]).includes(code)
        : (ROLE_DEFAULTS[code] as readonly string[]).includes(role.code) ||
          (OWNER_DERIVED_PERMISSIONS as readonly string[]).includes(code) ||
          (SCHEDULE_PERMISSIONS as readonly string[]).includes(code) ||
          optional[role.code]?.includes(code),
    ),
  };
}

/** يحصر المنح المخزنة للأكواد الجديدة في نطاق الدور؛ عضوية مدير خاطئة لا تتحول لسلطة شركة، والجهاز لا يحمل خانات ممنوعة. */
export function systemRoleGrantAllowedSql(memberAlias: string, grantAlias: string): SQL {
  const m = sql.identifier(memberAlias),
    g = sql.identifier(grantAlias);
  const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id;
  return sql`(${m}.role_owner_key <> 'global' OR (
    ${passkeyMembershipScopeSql(memberAlias, grantAlias)} AND
    (${m}.role_id <> ${role('device')}::uuid OR ${g}.permission_code NOT IN (${sql.join(
      deviceForbidden.map((code) => sql`${code}`),
      sql`,`,
    )}))
    AND (${m}.role_id <> ${role('business_manager')}::uuid OR ${g}.permission_code NOT IN
      ('create:customers:business','manage:discount-limits:business') OR ${m}.scope_type = 'BUSINESS')
    AND (${m}.role_id NOT IN (${role('branch_manager')}::uuid,${role('cashier')}::uuid)
      OR ${g}.permission_code <> 'create:customers:branch' OR ${m}.scope_type = 'BRANCH')))`;
}

/** يستبعد ALLOW المحظور للدور العالمي بما فيه الجهاز؛ يحفظ DENY والتاريخ ويقيد تفويض مدير النشاط بنطاقه. */
export function systemRoleOverrideAllowedSql(memberAlias: string, overrideAlias: string): SQL {
  const m = sql.identifier(memberAlias),
    o = sql.identifier(overrideAlias);
  const human = SYSTEM_ROLES.filter((r) => r.code !== 'device');
  const device = SYSTEM_ROLES.find((r) => r.code === 'device');
  const cells = human.map((role) => {
    const codes = systemRolePolicy(role.id, 'global')?.permissions ?? [];
    return sql`(${m}.role_id = ${role.id}::uuid AND ${
      codes.length === 0
        ? sql`false`
        : sql`${o}.permission_code IN (${sql.join(
            codes.map((c) => sql`${c}`),
            sql`,`,
          )})`
    })`;
  });
  const manager = human.find((r) => r.code === 'business_manager');
  const branchCreators = human.filter((r) => ['branch_manager', 'cashier'].includes(r.code));
  return sql`(NOT (${m}.role_owner_key = 'global' AND ${m}.role_id = ${device?.id}::uuid
    AND ${o}.effect = 'ALLOW' AND ${o}.permission_code IN (${sql.join(
      deviceForbidden.map((code) => sql`${code}`),
      sql`,`,
    )})) AND (${o}.effect = 'DENY' OR ${m}.role_owner_key <> 'global'
    OR ${m}.role_id NOT IN (${sql.join(
      human.map((r) => sql`${r.id}::uuid`),
      sql`,`,
    )})
    OR ((${sql.join(cells, sql` OR `)}) AND ${passkeyMembershipScopeSql(memberAlias, overrideAlias, true)} AND (
      ${m}.role_id <> ${manager?.id}::uuid
      OR ${o}.permission_code NOT IN ('read:memberships:business','manage:memberships:business',
        'create:customers:business','manage:discount-limits:business')
      OR (${m}.scope_type = 'BUSINESS' AND (
        (${o}.scope_type = 'BUSINESS' AND ${o}.scope_id = ${m}.scope_id)
        OR (${o}.scope_type = 'BRANCH' AND EXISTS (SELECT 1 FROM branches policy_branch
          WHERE policy_branch.company_id = ${m}.company_id AND policy_branch.id = ${o}.scope_id
            AND policy_branch.business_id = ${m}.scope_id)))))))
      AND (${m}.role_owner_key <> 'global' OR ${m}.role_id NOT IN (${sql.join(
        branchCreators.map((r) => sql`${r.id}::uuid`),
        sql`,`,
      )})
        OR ${o}.effect = 'DENY' OR ${o}.permission_code <> 'create:customers:branch'
        OR (${m}.scope_type = 'BRANCH' AND ${o}.scope_type = 'BRANCH' AND ${o}.scope_id = ${m}.scope_id)))`;
}

function passkeyMembershipScopeSql(
  memberAlias: string,
  permissionAlias: string,
  override = false,
): SQL {
  const m = sql.identifier(memberAlias);
  const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id;
  const code = sql`${sql.identifier(permissionAlias)}.permission_code`;
  const o = override ? sql.identifier(permissionAlias) : null;
  return sql`(${code} NOT IN ('read:passkeys:branch','unbind:passkeys:branch') OR (
    (${m}.role_id <> ${role('business_manager')}::uuid OR (${m}.scope_type='BUSINESS' ${o === null ? sql`` : sql`AND ((${o}.scope_type='BUSINESS' AND ${o}.scope_id=${m}.scope_id) OR (${o}.scope_type='BRANCH' AND EXISTS(SELECT 1 FROM branches pb WHERE pb.company_id=${m}.company_id AND pb.business_id=${m}.scope_id AND pb.id=${o}.scope_id)))`}))
    AND (${m}.role_id <> ${role('branch_manager')}::uuid OR (${m}.scope_type='BRANCH' ${o === null ? sql`` : sql`AND ${o}.scope_type='BRANCH' AND ${o}.scope_id=${m}.scope_id`}))
  ))`;
}

/** إسقاط هوية المالك الحقيقي في SQL؛ النطاق والمالك العالمي جزء من الهوية لا اسم الدور. */
export function canonicalOwnerSql(memberAlias: string, companyId: string): SQL {
  const m = sql.identifier(memberAlias);
  return sql`${m}.role_id = ${OWNER_ROLE_ID}::uuid AND ${m}.role_owner_key = 'global'
    AND ${m}.scope_type = 'COMPANY' AND ${m}.scope_id = ${companyId}::uuid`;
}
