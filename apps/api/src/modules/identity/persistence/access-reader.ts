import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { ScopeType } from '../domain/access.ts';
import type { AccessReader, ActiveMembership, SourcedGrant } from '../ports/access-reader.port.ts';

const ACTIVE = sql`m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())`;

/**
 * @param db the wrappers from @pospay/db
 * @returns the Postgres reader behind the access guard
 */
export function createAccessReader(db: TenantWrappers): AccessReader {
  return {
    companiesOf: (userId) =>
      db.withUser(userId, async (tx) => {
        const rows = await tx.execute<{ company_id: string }>(sql`
          SELECT DISTINCT m.company_id FROM memberships m WHERE m.user_id = ${userId} AND ${ACTIVE}`);
        return rows.map((row) => row.company_id);
      }),

    accessIn: (companyId, userId) => readAccess(db, companyId, userId),

    businessOfBranch: (companyId, branchId) =>
      db.withTenant(companyId, async (tx) => {
        const [row] = await tx.execute<{ business_id: string }>(sql`
          SELECT business_id FROM branches WHERE company_id = ${companyId} AND id = ${branchId}`);
        return row?.business_id ?? null;
      }),

    isFeatureEnabled: (companyId, flag) =>
      db.withTenant(companyId, async (tx) => {
        const [row] = await tx.execute<{ enabled: boolean }>(sql`
          SELECT COALESCE(
            (SELECT o.enabled FROM company_feature_overrides o
             WHERE o.company_id = ${companyId} AND o.flag = ${flag}
               AND (o.expires_at IS NULL OR o.expires_at > now())),
            (SELECT (p.feature_flags ->> ${flag})::boolean
             FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = ${companyId}),
            false) AS enabled`);
        return row?.enabled === true;
      }),
  };
}

function readAccess(
  db: TenantWrappers,
  companyId: string,
  userId: string,
): ReturnType<AccessReader['accessIn']> {
  return db.withTenant(
    companyId,
    async (tx) => {
      const memberships = await tx.execute<{ scope_type: ScopeType; scope_id: string }>(sql`
        SELECT m.scope_type, m.scope_id FROM memberships m
        WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${ACTIVE}`);
      const grants = await tx.execute<{
        permission: string;
        effect: 'ALLOW' | 'DENY';
        source: 'role' | 'override';
        scope_type: ScopeType;
        scope_id: string;
      }>(sql`
        SELECT rp.permission_code AS permission, 'ALLOW' AS effect, 'role' AS source, m.scope_type, m.scope_id
        FROM memberships m
        JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
        WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${ACTIVE}
        UNION ALL
        SELECT o.permission_code, o.effect, 'override', o.scope_type, o.scope_id
        FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE o.company_id = ${companyId} AND m.user_id = ${userId} AND ${ACTIVE}
          AND (o.expires_at IS NULL OR o.expires_at > now())`);
      return {
        memberships: memberships.map((row): ActiveMembership => ({
          scopeType: row.scope_type,
          scopeId: row.scope_id,
        })),
        grants: grants.map((row): SourcedGrant => ({
          permission: row.permission,
          effect: row.effect,
          source: row.source,
          scopeType: row.scope_type,
          scopeId: row.scope_id,
        })),
      };
    },
    { userId },
  );
}
