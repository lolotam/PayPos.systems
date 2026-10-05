import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OverrideTerms } from '../domain/permission-edit.ts';
import type {
  PermissionOverrideScope,
  PermissionOverrideTransactions,
  SavedPermissionOverride,
} from '../ports/permission-overrides.port.ts';
import { permissionEditorContext } from './permission-editor-context.ts';

const columns = sql`id, permission_code, effect, scope_type, scope_id, reason, granted_by,
  to_json(granted_at) #>> '{}' AS granted_at, to_json(expires_at) #>> '{}' AS expires_at`;
type OverrideRow = SavedPermissionOverride & Record<string, unknown>;

function scopeFor(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
): PermissionOverrideScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    context: (membershipId, terms) =>
      permissionEditorContext(tx, companyId, userId, membershipId, terms),
    current: async (membershipId, terms, now) =>
      Array.from(
        await tx.execute<OverrideRow>(sql`
      SELECT ${columns} FROM permission_overrides WHERE company_id = ${companyId} AND membership_id = ${membershipId}
        AND permission_code = ${terms.permission_code} AND scope_type = ${terms.scope_type} AND scope_id = ${terms.scope_id}
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()}::timestamptz) ORDER BY id FOR UPDATE`),
      ),
    find: async (membershipId, overrideId, businessId) => {
      const [row] = await tx.execute<OverrideRow>(sql`SELECT ${columns} FROM permission_overrides o
        WHERE company_id = ${companyId} AND membership_id = ${membershipId} AND id = ${overrideId}
          AND ${
            businessId === undefined
              ? sql`true`
              : sql`
            EXISTS (SELECT 1 FROM memberships m WHERE m.company_id = ${companyId} AND m.id = o.membership_id
              AND ${insideBusiness(companyId, businessId, 'm')})
            AND ${insideBusiness(companyId, businessId, 'o')}`
          }`);
      return row ?? null;
    },
    end: async (membershipId, overrideId, now) => {
      const [row] = await tx.execute<OverrideRow>(sql`UPDATE permission_overrides
        SET expires_at = ${now.toISOString()}::timestamptz
        WHERE company_id = ${companyId} AND membership_id = ${membershipId} AND id = ${overrideId}
        RETURNING ${columns}`);
      if (row === undefined) throw new Error('Locked permission override missing');
      return row;
    },
    insert: (membershipId, terms, now) =>
      insertOverride(tx, companyId, userId, ids, membershipId, terms, now),
  };
}

function insideBusiness(companyId: string, businessId: string, alias: 'm' | 'o') {
  const row = sql.identifier(alias);
  return sql`(${row}.scope_business_id = ${businessId}::uuid OR ${row}.scope_branch_id IN (
    SELECT id FROM branches WHERE company_id = ${companyId} AND business_id = ${businessId}))`;
}

async function insertOverride(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  membershipId: string,
  terms: OverrideTerms,
  now: Date,
): Promise<SavedPermissionOverride> {
  const id = ids.newId();
  await tx.execute(sql`INSERT INTO permission_overrides
    (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by, granted_at, expires_at)
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
