import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';
import type { EditableMembership, OverrideTerms } from '../domain/permission-edit.ts';
import type {
  PermissionOverrideScope,
  PermissionOverrideTransactions,
} from '../ports/permission-overrides.port.ts';

async function targetOf(
  tx: Tx,
  companyId: string,
  terms: OverrideTerms,
): Promise<AccessTarget | null> {
  if (terms.scope_type === 'COMPANY') return terms.scope_id === companyId ? { companyId } : null;
  if (terms.scope_type === 'BUSINESS') {
    const rows = await tx.execute(
      sql`SELECT 1 FROM businesses WHERE company_id = ${companyId} AND id = ${terms.scope_id}`,
    );
    return rows.length === 1 ? { companyId, businessId: terms.scope_id } : null;
  }
  const [row] = await tx.execute<{ business_id: string }>(sql`
    SELECT business_id FROM branches WHERE company_id = ${companyId} AND id = ${terms.scope_id}`);
  return row === undefined
    ? null
    : { companyId, businessId: row.business_id, branchId: terms.scope_id };
}

async function editorGrants(tx: Tx, companyId: string, userId: string): Promise<AccessGrant[]> {
  const rows = await tx.execute<{
    permission: string;
    effect: 'ALLOW' | 'DENY';
    scope_type: ScopeType;
    scope_id: string;
  }>(sql`
    SELECT rp.permission_code AS permission, 'ALLOW' AS effect, m.scope_type, m.scope_id
    FROM memberships m JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
    UNION ALL
    SELECT o.permission_code, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
    WHERE o.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND (o.expires_at IS NULL OR o.expires_at > now())`);
  return rows.map((row) => ({
    permission: row.permission,
    effect: row.effect,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  }));
}

async function lockMembership(
  tx: Tx,
  companyId: string,
  id: string,
): Promise<EditableMembership | null> {
  const [row] = await tx.execute<{
    id: string;
    scope_type: ScopeType;
    scope_id: string;
    starts_at: Date;
    ends_at: Date | null;
  }>(sql`
    SELECT id, scope_type, scope_id, starts_at, ends_at FROM memberships
    WHERE company_id = ${companyId} AND id = ${id} FOR UPDATE`);
  return row === undefined
    ? null
    : {
        id: row.id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        startsAt: new Date(row.starts_at),
        endsAt: row.ends_at === null ? null : new Date(row.ends_at),
      };
}

function scopeFor(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
): PermissionOverrideScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    context: async (membershipId, terms, now) => {
      const membership = await lockMembership(tx, companyId, membershipId);
      const [company] = await tx.execute(
        sql`SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL`,
      );
      const catalog = await tx.execute<{ code: string }>(
        sql`SELECT code FROM permissions WHERE code NOT LIKE '%:platform'`,
      );
      return {
        membership: company === undefined ? null : membership,
        catalog: catalog.map((row) => row.code),
        target: await targetOf(tx, companyId, terms),
        grants: await editorGrants(tx, companyId, userId),
        companyId,
        now,
      };
    },
    insert: (membershipId, terms, now) =>
      insertOverride(tx, companyId, userId, ids, membershipId, terms, now),
  };
}

async function insertOverride(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  membershipId: string,
  terms: OverrideTerms,
  now: Date,
) {
  // TODO(spec) OVERRIDE-LIFECYCLE: سياسة استبدال/سحب الاستثناء غير محسومة؛ الرفض مؤقتًا يمنع تكديس ALLOW وDENY متضاربين.
  const duplicate = await tx.execute(sql`
    SELECT 1 FROM permission_overrides WHERE company_id = ${companyId} AND membership_id = ${membershipId}
      AND permission_code = ${terms.permission_code} AND scope_type = ${terms.scope_type} AND scope_id = ${terms.scope_id}
      AND (expires_at IS NULL OR expires_at > ${now.toISOString()}::timestamptz)`);
  if (duplicate.length > 0) return null;
  const id = ids.newId();
  await tx.execute(sql`
    INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id,
      reason, granted_by, granted_at, expires_at)
    VALUES (${companyId}, ${id}, ${membershipId}, ${terms.permission_code}, ${terms.effect}, ${terms.scope_type},
      ${terms.scope_id}, ${terms.reason}, ${userId}, ${now.toISOString()}::timestamptz, ${terms.expires_at}::timestamptz)`);
  return { ...terms, id, granted_by: userId, granted_at: now.toISOString() };
}

export function createPermissionOverrideTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): PermissionOverrideTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(companyId, (tx) => work(scopeFor(tx, companyId, userId, ids)), { userId }),
  };
}
