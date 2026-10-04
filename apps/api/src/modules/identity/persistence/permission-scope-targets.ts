import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessTarget, ScopeType } from '../domain/access.ts';

// قارئ مشترك للـ guard وإعادة الفحص المقفولة؛ تعديل نطاق واسع يتأثر بكل DENY تابع له قبل فحص الجسم.
export async function readScopeTargets(
  tx: Tx,
  companyId: string,
  scope: { scope_type: ScopeType; scope_id: string },
) {
  const rows = await tx.execute<{ business_id: string; branch_id: string | null }>(sql`
    SELECT b.id AS business_id, NULL::uuid AS branch_id FROM businesses b
    WHERE b.company_id = ${companyId}
      AND (${scope.scope_type} = 'COMPANY' OR (${scope.scope_type} = 'BUSINESS' AND b.id = ${scope.scope_id}))
    UNION ALL
    SELECT br.business_id, br.id FROM branches br WHERE br.company_id = ${companyId}
      AND (${scope.scope_type} = 'COMPANY' OR (${scope.scope_type} = 'BUSINESS' AND br.business_id = ${scope.scope_id})
        OR (${scope.scope_type} = 'BRANCH' AND br.id = ${scope.scope_id}))`);
  const targets: AccessTarget[] = rows.map((row) => ({
    companyId,
    businessId: row.business_id,
    ...(row.branch_id === null ? {} : { branchId: row.branch_id }),
  }));
  const target =
    scope.scope_type === 'COMPANY'
      ? scope.scope_id === companyId
        ? { companyId }
        : null
      : (targets.find((t) =>
          scope.scope_type === 'BRANCH'
            ? t.branchId === scope.scope_id
            : t.businessId === scope.scope_id && t.branchId === undefined,
        ) ?? null);
  return { target, descendantTargets: targets };
}
