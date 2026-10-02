import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';
import type { OverrideTerms, PermissionEditContext } from '../domain/permission-edit.ts';

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
  // قفل عضويات المحرر والهدف بترتيب ثابت يمنع تغيير DENY أثناء التفويض ويمنع deadlock بين محررين.
  const rows = await tx.execute<{
    id: string;
    user_id: string | null;
    role_id: string;
    role_owner_key: string;
    scope_type: ScopeType;
    scope_id: string;
    starts_at: Date;
    ends_at: Date | null;
  }>(sql`SELECT id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at
    FROM memberships WHERE company_id = ${companyId} AND (id = ${membershipId} OR user_id = ${userId})
    ORDER BY id FOR UPDATE`);
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) throw new Error('Transaction time missing');
  const now = new Date(time.at);
  const row = rows.find((m) => m.id === membershipId);
  const [role] =
    row === undefined
      ? []
      : await tx.execute<{ code: string }>(sql`
    SELECT code FROM roles WHERE id = ${row.role_id} AND owner_key = ${row.role_owner_key}`);
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL`,
  );
  const catalog = await tx.execute<{ code: string }>(
    sql`SELECT code FROM permissions WHERE code NOT LIKE '%:platform'`,
  );
  return {
    membership:
      row === undefined || company === undefined || role === undefined
        ? null
        : {
            id: row.id,
            userId: row.user_id,
            roleCode: role.code,
            scopeType: row.scope_type,
            scopeId: row.scope_id,
            startsAt: new Date(row.starts_at),
            endsAt: row.ends_at === null ? null : new Date(row.ends_at),
          },
    ...(await scopeTargets(tx, companyId, terms)),
    catalog: catalog.map((p) => p.code),
    grants: await editorGrants(tx, companyId, userId, now.toISOString()),
    companyId,
    editorUserId: userId,
    now,
  };
}
