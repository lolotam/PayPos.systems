import { canonicalOwnerSql, systemRolePolicy, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { readAccessTransaction } from './access-reader.ts';
import type { AccessGrant, ScopeType } from '../domain/access.ts';
import { readScopeTargets } from './permission-scope-targets.ts';
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

async function editorGrants(
  tx: Tx,
  companyId: string,
  userId: string,
  now: string,
): Promise<AccessGrant[]> {
  const access = await readAccessTransaction(tx, companyId, userId, new Date(now));
  return [...access.grants];
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
  const [editor] = await tx.execute<{ is_owner: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM memberships m WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND ${canonicalOwnerSql('m', companyId)}
      AND m.starts_at <= ${now.toISOString()}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${now.toISOString()}::timestamptz)
  ) AS is_owner`);
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
            await readScopeTargets(tx, companyId, {
              scope_type: membership.scopeType,
              scope_id: membership.scopeId,
            })
          ).target,
    holderMemberships,
    ...(await readScopeTargets(tx, companyId, terms)),
    catalog: catalog.map((p) => p.code),
    grants: await editorGrants(tx, companyId, userId, now.toISOString()),
    companyId,
    editorUserId: userId,
    editorIsCompanyOwner: editor?.is_owner === true,
    now,
  };
}
