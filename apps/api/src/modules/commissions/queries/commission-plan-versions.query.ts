import {
  commissionPlanVersion,
  commissionPlanVersionList,
  type CommissionPlanVersionList,
  type CommissionPlanVersionListQuery,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type PlanVersionRow = {
  readonly id: string;
  readonly employee_id: string;
  readonly version: number;
  readonly effective_from: string;
  readonly whole_period: boolean;
  readonly repair_period: string | null;
  readonly base: unknown;
  readonly tiers: unknown;
  readonly package_sale: unknown;
  readonly created_at: string;
  readonly created_by: string;
};

function cursorClause(cursor: number | undefined) {
  return cursor === undefined ? sql`` : sql`AND version < ${cursor}`;
}

/** شاشة منشئ الخطة تقرأ سجل الموظفة من الأحدث للأقدم بمؤشر رقم الإصدار. */
export function listCommissionPlanVersionsStatement(
  companyId: string,
  businessId: string,
  employeeId: string,
  query: CommissionPlanVersionListQuery,
) {
  return sql`SELECT id,employee_id,version,to_char(effective_from,'YYYY-MM-DD') AS effective_from,
    whole_period,repair_period,plan->'base' AS base,plan->'tiers' AS tiers,
    plan->'package_sale' AS package_sale,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,created_by
    FROM commission_plan_versions
    WHERE company_id=${companyId} AND business_id=${businessId} AND employee_id=${employeeId}
    ${cursorClause(query.cursor)} ORDER BY version DESC LIMIT ${query.limit + 1}`;
}

export async function listCommissionPlanVersions(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
  query: CommissionPlanVersionListQuery,
): Promise<CommissionPlanVersionList> {
  const rows = await tx.execute<PlanVersionRow>(
    listCommissionPlanVersionsStatement(companyId, businessId, employeeId, query),
  );
  const items = rows.slice(0, query.limit).map((row) => commissionPlanVersion.parse(row));
  const last = items.at(-1);
  return commissionPlanVersionList.parse({
    items,
    next_cursor: rows.length > query.limit && last !== undefined ? last.version : null,
  });
}
