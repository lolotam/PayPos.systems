import {
  canonicalOwnerSql,
  OWNER_DERIVED_PERMISSIONS,
  systemRoleOverrideAllowedSql,
  systemRoleGrantAllowedSql,
  type Tx,
  type TenantWrappers,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { parsePermissionConstraints, type ScopeType } from '../domain/access.ts';
import { protectOwnerAccess } from '../domain/owner-access.ts';
import type {
  AccessReader,
  ActiveMembership,
  SourcedGrant,
  CompanyAccess,
  AccessTargetRequest,
  ResolvedAccessTargets,
} from '../ports/access-reader.port.ts';
import { companyIsActive } from './company-active-lock.ts';
import { readFeatureEnabled } from './feature-reader.ts';
import { readScopeTargets } from './permission-scope-targets.ts';

const SALARY_CODES = sql.join(
  OWNER_DERIVED_PERMISSIONS.map((p) => sql`${p}`),
  sql`,`,
);

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

    accessAt: (companyId, userId, request, options) =>
      db.withTenant(
        companyId,
        async (tx) => {
          const targets = await readRequestTargets(tx, companyId, request);
          if (targets === null) return null;
          const access = await readAccessTransaction(tx, companyId, userId);
          if (!options.allows({ targets, access })) return null;
          const { featureFlag } = options;
          const feature =
            featureFlag === undefined
              ? undefined
              : {
                  flag: featureFlag,
                  enabled: await readFeatureEnabled(tx, companyId, featureFlag),
                };
          return { targets, access, ...(feature === undefined ? {} : { feature }) };
        },
        { userId },
      ),

    accessAtBranches: (companyId, userId, branchIds) =>
      db.withTenant(
        companyId,
        async (tx) => {
          const businesses = await readBranchBusinesses(tx, companyId, branchIds);
          if (businesses.size === 0) return null;
          return { businesses, access: await readAccessTransaction(tx, companyId, userId) };
        },
        { userId },
      ),

    isFeatureEnabled: (companyId, flag) =>
      db.withTenant(companyId, (tx) => readFeatureEnabled(tx, companyId, flag)),

    coversBusiness: (companyId, userId, businessId) =>
      db.withTenant(
        companyId,
        async (tx) => {
          if (!(await companyIsActive(tx, companyId))) return false;
          return coversBusinessScope(tx, companyId, userId, businessId);
        },
        { userId },
      ),
  };
}

/**
 * هل فيه عضوية سارية للمستخدم بتغطي النشاط: نطاق الشركة، أو النشاط نفسه، أو فرع تابع له.
 * الفحص بيقرأ من غير قفل، وفروع النشاط بتتجمّع من جدول واحد، فما فيش استعلام لكل فرع (TQ-1).
 *
 * @param tx         معاملة withTenant للشركة
 * @param companyId  الشركة
 * @param userId     المستخدم
 * @param businessId النشاط المطلوب
 * @returns true لما فيه عضوية سارية بتغطي النشاط
 */
async function coversBusinessScope(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<boolean> {
  const businesses = await tx.execute<{ id: string }>(sql`
    SELECT id FROM businesses WHERE company_id = ${companyId} AND id = ${businessId}`);
  if (businesses.length !== 1) return false;
  const memberships = await tx.execute<{ id: string }>(sql`
    SELECT m.id FROM memberships m
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${ACTIVE}
      AND (
        (m.scope_type = 'COMPANY' AND m.scope_id = ${companyId})
        OR (m.scope_type = 'BUSINESS' AND m.scope_id = ${businessId})
        OR (m.scope_type = 'BRANCH' AND m.scope_id IN (
          SELECT b.id FROM branches b WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}))
      )
    LIMIT 1`);
  return memberships.length === 1;
}

async function readBranchBusinesses(
  tx: Tx,
  companyId: string,
  branchIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await tx.execute<{ id: string; business_id: string }>(sql`
    SELECT id, business_id FROM branches WHERE company_id=${companyId}
      AND id=ANY(ARRAY[${sql.join(
        branchIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])`);
  return new Map(rows.map((row) => [row.id, row.business_id]));
}

async function readRequestTargets(
  tx: Tx,
  companyId: string,
  request: AccessTargetRequest,
): Promise<ResolvedAccessTargets | null> {
  if (request.kind === 'membership') {
    const [row] = await tx.execute<{ scope_type: ScopeType; scope_id: string }>(sql`
      SELECT m.scope_type, m.scope_id FROM memberships m
      JOIN companies c ON c.id=m.company_id AND c.deleted_at IS NULL
      WHERE m.company_id=${companyId} AND m.id=${request.membershipId} AND ${ACTIVE}`);
    if (row === undefined) return null;
    const scopes = await readScopeTargets(tx, companyId, row);
    return scopes.target === null
      ? null
      : { target: scopes.target, descendantTargets: scopes.descendantTargets };
  }
  if (request.kind === 'branch') {
    const businessId = (await readBranchBusinesses(tx, companyId, [request.branchId])).get(
      request.branchId,
    );
    return businessId === undefined
      ? null
      : { target: { companyId, businessId, branchId: request.branchId }, descendantTargets: [] };
  }
  if (request.kind === 'business') {
    const rows = await tx.execute(
      sql`SELECT 1 FROM businesses WHERE company_id=${companyId} AND id=${request.businessId}`,
    );
    return rows.length === 1
      ? { target: { companyId, businessId: request.businessId }, descendantTargets: [] }
      : null;
  }
  return { target: { companyId }, descendantTargets: [] };
}

type AccessGrantRow = {
  permission: string;
  effect: 'ALLOW' | 'DENY';
  source: 'role' | 'override';
  scope_type: ScopeType;
  scope_id: string;
  constraints: unknown;
};

function toSourcedGrant(row: AccessGrantRow): SourcedGrant {
  const constraints = parsePermissionConstraints(row.constraints);
  return {
    permission: row.permission,
    effect: row.effect,
    source: row.source,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    ...(constraints === undefined ? {} : { constraints }),
  };
}

/**
 * عضويات المستخدم السارية ومنحه جوه transaction الشركة.
 * الفحص SELECT من غير قفل صف: مسار القراءة ممنوع يستنى أي قفل.
 * الكتابة متسلسلة لأن كل إعادة فحص بتمسك صف الشركة FOR NO KEY UPDATE في نفس المعاملة
 * عن طريق lock*Access، والقفل ده بيتعارض مع أي UPDATE للصف بما فيه الحذف الناعم،
 * فالحذف مش يقدر يتسجل بين الفحص والكتابة.
 * صف مش ظاهر أو deleted_at متعبّى بيرجّع صفر عضويات وصفر منح والـ guard بيرفض بالفحص الموجود.
 *
 * @param tx         معاملة withTenant للشركة
 * @param companyId  الشركة
 * @param userId     المستخدم
 * @param decisionAt لحظة التقييم لو مختلفة عن وقت المعاملة
 * @returns العضويات والمنح، أو الاتنين فاضيين لما الشركة محذوفة أو مش ظاهرة
 */
export async function readAccessTransaction(
  tx: Tx,
  companyId: string,
  userId: string,
  decisionAt?: Date,
): Promise<CompanyAccess> {
  if (!(await companyIsActive(tx, companyId))) return { memberships: [], grants: [] };
  const at = decisionAt === undefined ? sql`now()` : sql`${decisionAt.toISOString()}::timestamptz`;
  const active = sql`m.starts_at <= ${at} AND (m.ends_at IS NULL OR m.ends_at > ${at})`;
  const memberships = await tx.execute<{
    scope_type: ScopeType;
    scope_id: string;
    is_owner: boolean;
  }>(sql`
        SELECT m.scope_type, m.scope_id, (${canonicalOwnerSql('m', companyId)}) AS is_owner FROM memberships m
        JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
        WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${active}`);
  const grants = await tx.execute<AccessGrantRow>(sql`
        SELECT rp.permission_code AS permission, 'ALLOW' AS effect, 'role' AS source, m.scope_type, m.scope_id, rp.constraints::text AS constraints
        FROM memberships m
        JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
        WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${active}
          AND rp.permission_code NOT IN (${SALARY_CODES})
          AND ${systemRoleGrantAllowedSql('m', 'rp')}
        UNION ALL
        SELECT p.code, 'ALLOW', 'role', m.scope_type, m.scope_id, '{}'::text AS constraints
        FROM memberships m
        CROSS JOIN permissions p
        WHERE m.company_id=${companyId} AND m.user_id=${userId} AND ${active} AND ${canonicalOwnerSql('m', companyId)}
          AND p.code IN (${SALARY_CODES})
        UNION ALL
        SELECT o.permission_code, o.effect, 'override', o.scope_type, o.scope_id, '{}'::text AS constraints
        FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE o.company_id = ${companyId} AND m.user_id = ${userId} AND ${active}
          AND (o.expires_at IS NULL OR o.expires_at > ${at})
          AND ${systemRoleOverrideAllowedSql('m', 'o')}`);
  return {
    memberships: memberships.map((row): ActiveMembership => ({
      scopeType: row.scope_type,
      scopeId: row.scope_id,
    })),
    grants: protectOwnerAccess(
      grants.map(toSourcedGrant),
      memberships.some((m) => m.is_owner),
    ),
  };
}
