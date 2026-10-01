import type { WorkspaceCompanyNames } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface WorkspaceScope {
  readonly scope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
}

const SCOPE_NAMES = new Set<WorkspaceScope['scope']>(['COMPANY', 'BUSINESS', 'BRANCH']);

function knownScopes(scopes: readonly WorkspaceScope[]): WorkspaceScope[] {
  return scopes.filter((scope) => SCOPE_NAMES.has(scope.scope));
}

function branchRows(companyId: string, reached: SQL) {
  return sql`
    SELECT b.business_id, b.id, b.name_ar, b.name_en,
           COALESCE(b.timezone, bu.timezone) AS effective_timezone, b.is_active
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    WHERE b.company_id = ${companyId} AND ${reached}`;
}

function branchHit(companyId: string) {
  return sql`
    ${branchRows(companyId, sql`EXISTS (SELECT 1 FROM scopes WHERE scope = 'COMPANY')`)}
    UNION
    ${branchRows(companyId, sql`b.business_id IN (SELECT scope_id FROM scopes WHERE scope = 'BUSINESS')`)}
    UNION
    ${branchRows(companyId, sql`b.id IN (SELECT scope_id FROM scopes WHERE scope = 'BRANCH')`)}`;
}

function businessRows(companyId: string, reached: SQL) {
  return sql`
    SELECT bu.id, bu.name_ar, bu.name_en
    FROM businesses bu
    WHERE bu.company_id = ${companyId} AND ${reached}`;
}

function businessHit(companyId: string) {
  return sql`
    ${businessRows(companyId, sql`EXISTS (SELECT 1 FROM scopes WHERE scope = 'COMPANY')`)}
    UNION
    ${businessRows(companyId, sql`bu.id IN (SELECT scope_id FROM scopes WHERE scope = 'BUSINESS')`)}
    UNION
    ${businessRows(companyId, sql`bu.id IN (SELECT business_id FROM branch_hit)`)}`;
}

// Screen: admin › tenant selector. One company inside the caller's withTenant transaction: COMPANY reaches every
// business and branch, BUSINESS that business and its branches, BRANCH that branch and its parent business.
// company_id is bound from app_company_id() so the planner can use the tenant indexes. Branches are grouped once
// per business and joined, so a large company costs one pass over its branches, not one pass per business.
function treeQuery(companyId: string, payload: string) {
  return sql`
    WITH scopes AS (
      SELECT scope, scope_id
      FROM jsonb_to_recordset(${payload}::jsonb) AS s(scope text, scope_id uuid)
    ),
    branch_hit AS (
      ${branchHit(companyId)}
    ),
    business_hit AS (
      ${businessHit(companyId)}
    ),
    branch_tree AS (
      SELECT br.business_id, jsonb_agg(jsonb_build_object(
        'id', br.id, 'name_ar', br.name_ar, 'name_en', br.name_en,
        'effective_timezone', br.effective_timezone, 'is_active', br.is_active
      ) ORDER BY br.name_en, br.id) AS branches
      FROM branch_hit br
      GROUP BY br.business_id
    )
    SELECT c.id, c.name_ar, c.name_en, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bu.id, 'name_ar', bu.name_ar, 'name_en', bu.name_en,
        'branches', COALESCE(bt.branches, '[]'::jsonb)
      ) ORDER BY bu.name_en, bu.id)
      FROM business_hit bu
      LEFT JOIN branch_tree bt ON bt.business_id = bu.id
    ), '[]'::jsonb) AS businesses
    FROM companies c
    WHERE c.id = ${companyId} AND c.deleted_at IS NULL`;
}

async function currentCompany(tx: Tx): Promise<string | null> {
  const [row] = Array.from(
    await tx.execute<{ id: string | null }>(sql`SELECT app_company_id() AS id`),
  );
  return row?.id ?? null;
}

type TreeRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly businesses: WorkspaceCompanyNames['businesses'] | string;
};

function treeOf(row: TreeRow): WorkspaceCompanyNames {
  const businesses =
    typeof row.businesses === 'string' ? JSON.parse(row.businesses) : row.businesses;
  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    businesses: businesses as WorkspaceCompanyNames['businesses'],
  };
}

export async function describeWorkspaces(
  tx: Tx,
  scopes: readonly WorkspaceScope[],
): Promise<WorkspaceCompanyNames | null> {
  const known = knownScopes(scopes);
  if (known.length === 0) return null;
  const companyId = await currentCompany(tx);
  if (companyId === null) return null;
  const payload = JSON.stringify(
    known.map((scope) => ({ scope: scope.scope, scope_id: scope.scopeId })),
  );
  const [row] = Array.from(await tx.execute<TreeRow>(treeQuery(companyId, payload)));
  return row === undefined ? null : treeOf(row);
}
