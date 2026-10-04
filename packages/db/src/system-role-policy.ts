import { sql, type SQL } from 'drizzle-orm';
import { OWNER_ROLE_ID, PERMISSIONS, SYSTEM_ROLES, type Permission } from './access-catalog.ts';
import {
  ROLE_DEFAULTS,
  OWNER_DERIVED_PERMISSIONS,
  SCHEDULE_PERMISSIONS,
  LEAVE_PERMISSIONS,
} from './role-defaults.ts';

// spec 009 يجعل الأدوار المحذوفة من الصف ❌؛ الجهاز لا يرث سلطة موظف من ALLOW قديم.
const deviceForbidden = [
  ...LEAVE_PERMISSIONS,
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
] as const satisfies readonly Permission[];
// TODO(spec) DEVICE-Q1: أكواد الملفات والموظفين والعملاء والخصم ودخول الموظف تنتظر قرار منع الجهاز؛ توصيتنا حظر الستة في spec 019.

const optional: Readonly<Record<string, readonly string[]>> = {
  business_manager: ['read:memberships:business', 'manage:memberships:business'],
  branch_manager: ['read:settings:business', 'manage:settings:business'],
  cashier: ['login:staff:branch'],
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
  return sql`(NOT (${m}.role_owner_key = 'global' AND ${m}.role_id = ${device?.id}::uuid
    AND ${o}.effect = 'ALLOW' AND ${o}.permission_code IN (${sql.join(
      deviceForbidden.map((code) => sql`${code}`),
      sql`,`,
    )})) AND (${o}.effect = 'DENY' OR ${m}.role_owner_key <> 'global'
    OR ${m}.role_id NOT IN (${sql.join(
      human.map((r) => sql`${r.id}::uuid`),
      sql`,`,
    )})
    OR ((${sql.join(cells, sql` OR `)}) AND (
      ${m}.role_id <> ${manager?.id}::uuid
      OR ${o}.permission_code NOT IN ('read:memberships:business','manage:memberships:business')
      OR (${m}.scope_type = 'BUSINESS' AND (
        (${o}.scope_type = 'BUSINESS' AND ${o}.scope_id = ${m}.scope_id)
        OR (${o}.scope_type = 'BRANCH' AND EXISTS (SELECT 1 FROM branches policy_branch
          WHERE policy_branch.company_id = ${m}.company_id AND policy_branch.id = ${o}.scope_id
            AND policy_branch.business_id = ${m}.scope_id))))))))`;
}

/** إسقاط هوية المالك الحقيقي في SQL؛ النطاق والمالك العالمي جزء من الهوية لا اسم الدور. */
export function canonicalOwnerSql(memberAlias: string, companyId: string): SQL {
  const m = sql.identifier(memberAlias);
  return sql`${m}.role_id = ${OWNER_ROLE_ID}::uuid AND ${m}.role_owner_key = 'global'
    AND ${m}.scope_type = 'COMPANY' AND ${m}.scope_id = ${companyId}::uuid`;
}
