import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess, type AccessGrant } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

export async function readAttendanceChangeAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: string | readonly string[],
  now: Date,
) {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const candidates = typeof branchIds === 'string' ? [branchIds] : branchIds;
  const branches = candidates.filter((branchId) =>
    evaluateAccess(access.grants, 'request:attendance-change:branch', {
      companyId,
      businessId,
      branchId,
      actorUserId: userId,
    }),
  );
  const decideBranches = candidates.filter((branchId) =>
    evaluateAccess(access.grants, 'decide:attendance-change:company', {
      companyId,
      businessId,
      branchId,
    }),
  );
  const canDecide =
    typeof branchIds === 'string'
      ? decideBranches.length > 0
      : decideBranches.length > 0 ||
        evaluateAccess(access.grants, 'decide:attendance-change:company', {
          companyId,
          businessId,
        });
  const at = sql`${now.toISOString()}::timestamptz`;
  const active = sql`m.company_id=${companyId} AND m.user_id=${userId} AND m.starts_at<=${at}
      AND (m.ends_at IS NULL OR m.ends_at>${at})`;
  const [row] = await tx.execute<{ owner: boolean; member: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM memberships m WHERE ${active} AND ${canonicalOwnerSql('m', companyId)}) AS owner,
      EXISTS(SELECT 1 FROM memberships m WHERE ${active} AND (
        (m.scope_type='COMPANY' AND m.scope_id=${companyId}::uuid)
        OR (m.scope_type='BUSINESS' AND m.scope_id=${businessId}::uuid)
        OR (m.scope_type='BRANCH' AND EXISTS(SELECT 1 FROM branches b
          WHERE b.company_id=m.company_id AND b.id=m.scope_id AND b.business_id=${businessId}::uuid)))) AS member`);
  return {
    canRequest: branches.length > 0,
    canDecide,
    owner: row?.owner === true,
    member: row?.member === true,
    branches: [...branches],
    decideBranches,
  };
}

export async function readAttendanceChangeApprovers(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  now: Date,
): Promise<{ userId: string; owner: boolean }[]> {
  const rows = await tx.execute<{ user_id: string; owner: boolean }>(sql`
    SELECT m.user_id, bool_or(${canonicalOwnerSql('m', companyId)}) AS owner
    FROM memberships m WHERE m.company_id=${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at<=${now.toISOString()}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at>${now.toISOString()}::timestamptz)
    GROUP BY m.user_id ORDER BY m.user_id`);
  const grants = await approverGrants(tx, companyId, now);
  return rows
    .filter(
      (row) =>
        row.owner ||
        evaluateAccess(grants.get(row.user_id) ?? [], 'decide:attendance-change:company', {
          companyId,
          businessId,
          branchId,
        }),
    )
    .map((row) => ({ userId: row.user_id, owner: row.owner }));
}

async function approverGrants(tx: Tx, companyId: string, now: Date) {
  const at = sql`${now.toISOString()}::timestamptz`;
  const active = sql`m.company_id=${companyId} AND m.user_id IS NOT NULL
    AND m.starts_at<=${at} AND (m.ends_at IS NULL OR m.ends_at>${at})`;
  const rows = await tx.execute<{
    user_id: string;
    effect: 'ALLOW' | 'DENY';
    scope_type: AccessGrant['scopeType'];
    scope_id: string;
  }>(sql`
    SELECT m.user_id, 'ALLOW' AS effect, m.scope_type, m.scope_id
    FROM memberships m JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
    WHERE ${active} AND rp.permission_code='decide:attendance-change:company'
      AND ${systemRoleGrantAllowedSql('m', 'rp')}
    UNION ALL
    SELECT m.user_id, o.effect, o.scope_type, o.scope_id
    FROM memberships m JOIN permission_overrides o ON o.company_id=m.company_id AND o.membership_id=m.id
    WHERE ${active} AND o.permission_code='decide:attendance-change:company'
      AND (o.expires_at IS NULL OR o.expires_at>${at}) AND ${systemRoleOverrideAllowedSql('m', 'o')}`);
  const grants = new Map<string, AccessGrant[]>();
  for (const row of rows) {
    const list = grants.get(row.user_id) ?? [];
    list.push({
      permission: 'decide:attendance-change:company',
      effect: row.effect,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
    });
    grants.set(row.user_id, list);
  }
  return grants;
}
