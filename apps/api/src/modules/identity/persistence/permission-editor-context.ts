import { canonicalOwnerSql, systemRolePolicy, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessTarget, ScopeType } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
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
  // نقفل الشركة NO KEY UPDATE ثم العضويات بترتيب id ثم الاستثناءات؛ فحص المالك يثبت، وKEY SHARE لإدراج سجل التدقيق لا ينتظر قفل الشركة.
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id = ${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return [];
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id = ${companyId} ORDER BY id FOR UPDATE`,
  );
  const rows = await tx.execute<{
    id: string;
    user_id: string | null;
    employee_id: string | null;
    role_code: string;
    role_id: string;
    role_owner_key: string;
    is_owner: boolean;
    scope_type: ScopeType;
    scope_id: string;
    starts_at: Date;
    ends_at: Date | null;
  }>(sql`SELECT m.id, m.user_id, m.employee_id, r.code AS role_code,
    m.role_id, m.role_owner_key, (${canonicalOwnerSql('m', companyId)}) AS is_owner,
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
    systemRoleCode: systemRolePolicy(row.role_id, row.role_owner_key)?.code ?? null,
    allowedPermissions: systemRolePolicy(row.role_id, row.role_owner_key)?.permissions ?? null,
    isCompanyOwner: row.is_owner,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at),
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
  const membership = holderMemberships.find((m) => m.id === membershipId) ?? null;
  return {
    membership,
    membershipTarget:
      membership === null
        ? null
        : (
            await scopeTargets(tx, companyId, {
              ...terms,
              scope_type: membership.scopeType,
              scope_id: membership.scopeId,
            })
          ).target,
    holderMemberships,
    ...(await scopeTargets(tx, companyId, terms)),
    catalog: catalog.map((p) => p.code),
    grants: (await readAccessTransaction(tx, companyId, userId, now)).grants,
    companyId,
    editorUserId: userId,
    now,
  };
}
