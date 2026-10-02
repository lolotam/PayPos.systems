import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';
import type {
  EditableMembership,
  OverrideTerms,
  PermissionEditContext,
} from '../domain/permission-edit.ts';

async function lockedHolderMemberships(
  tx: Tx,
  companyId: string,
  membershipId: string,
): Promise<EditableMembership[]> {
  // قفل الشركة يمنع إدخال عضوية جديدة عبر الـ FK؛ قفل المجموعة يمنع تبديل الدور أو صاحب العضوية أثناء فحص المالك.
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id = ${companyId} AND deleted_at IS NULL FOR UPDATE`);
  if (company === undefined) return [];
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id = ${companyId} ORDER BY id FOR UPDATE`,
  );
  const rows = await tx.execute<{
    id: string;
    user_id: string | null;
    employee_id: string | null;
    role_code: string;
    scope_type: ScopeType;
    scope_id: string;
    starts_at: Date;
    ends_at: Date | null;
  }>(sql`SELECT m.id, m.user_id, m.employee_id, r.code AS role_code,
    m.scope_type, m.scope_id, m.starts_at, m.ends_at
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND EXISTS (
      SELECT 1 FROM memberships target WHERE target.company_id = ${companyId} AND target.id = ${membershipId}
        AND (m.user_id = target.user_id OR m.employee_id = target.employee_id))`);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    employeeId: row.employee_id,
    roleCode: row.role_code,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at),
  }));
}

async function editorGrants(
  tx: Tx,
  companyId: string,
  userId: string,
  now: string,
): Promise<AccessGrant[]> {
  const rows = await tx.execute<{
    permission: string;
    effect: 'ALLOW' | 'DENY';
    scope_type: ScopeType;
    scope_id: string;
  }>(sql`
    SELECT rp.permission_code AS permission, 'ALLOW' AS effect, m.scope_type, m.scope_id
    FROM memberships m JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= ${now}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${now}::timestamptz)
    UNION ALL
    SELECT o.permission_code, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
    WHERE o.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= ${now}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${now}::timestamptz)
      AND (o.expires_at IS NULL OR o.expires_at > ${now}::timestamptz)`);
  return rows.map((row) => ({
    permission: row.permission,
    effect: row.effect,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  }));
}

async function scopeTargets(tx: Tx, companyId: string, terms: OverrideTerms) {
  const rows = await tx.execute<{ business_id: string; branch_id: string | null }>(sql`
    SELECT b.id AS business_id, NULL::uuid AS branch_id FROM businesses b
    WHERE b.company_id = ${companyId}
      AND (${terms.scope_type} = 'COMPANY' OR (${terms.scope_type} = 'BUSINESS' AND b.id = ${terms.scope_id}))
    UNION ALL
    SELECT br.business_id, br.id FROM branches br WHERE br.company_id = ${companyId}
      AND (${terms.scope_type} = 'COMPANY' OR (${terms.scope_type} = 'BUSINESS' AND br.business_id = ${terms.scope_id})
        OR (${terms.scope_type} = 'BRANCH' AND br.id = ${terms.scope_id}))`);
  const targets: AccessTarget[] = rows.map((row) => ({
    companyId,
    businessId: row.business_id,
    ...(row.branch_id === null ? {} : { branchId: row.branch_id }),
  }));
  const target =
    terms.scope_type === 'COMPANY'
      ? terms.scope_id === companyId
        ? { companyId }
        : null
      : (targets.find((t) =>
          terms.scope_type === 'BRANCH'
            ? t.branchId === terms.scope_id
            : t.businessId === terms.scope_id && t.branchId === undefined,
        ) ?? null);
  return { target, descendantTargets: targets };
}

export async function permissionEditorContext(
  tx: Tx,
  companyId: string,
  userId: string,
  membershipId: string,
  terms: OverrideTerms,
): Promise<PermissionEditContext> {
  const holderMemberships = await lockedHolderMemberships(tx, companyId, membershipId);
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) throw new Error('Transaction time missing');
  const now = new Date(time.at);
  const catalog = await tx.execute<{ code: string }>(
    sql`SELECT code FROM permissions WHERE code NOT LIKE '%:platform'`,
  );
  return {
    membership: holderMemberships.find((m) => m.id === membershipId) ?? null,
    holderMemberships,
    ...(await scopeTargets(tx, companyId, terms)),
    catalog: catalog.map((p) => p.code),
    grants: await editorGrants(tx, companyId, userId, now.toISOString()),
    companyId,
    editorUserId: userId,
    now,
  };
}
