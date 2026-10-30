import { commissionPlanVersion, type CommissionPlanVersion } from '@pospay/contracts';
import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

const CREATED_AT = `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type StoredRow = {
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

function stored(row: StoredRow): CommissionPlanVersion {
  return commissionPlanVersion.parse(row);
}

function plan(record: CommissionPlanVersion): string {
  return JSON.stringify({
    base: record.base,
    tiers: record.tiers,
    package_sale: record.package_sale,
  });
}

export async function insertPlanVersion(
  tx: Tx,
  companyId: string,
  businessId: string,
  record: CommissionPlanVersion,
): Promise<CommissionPlanVersion> {
  const [row] = await tx.execute<StoredRow>(sql`INSERT INTO commission_plan_versions(
    company_id,id,business_id,employee_id,version,effective_from,whole_period,repair_period,plan,created_at,created_by)
    VALUES (${companyId},${record.id},${businessId},${record.employee_id},${record.version},
      ${record.effective_from}::date,${record.whole_period},${record.repair_period},${plan(record)}::jsonb,
      ${record.created_at}::timestamptz,${record.created_by})
    RETURNING id,employee_id,version,to_char(effective_from,'YYYY-MM-DD') AS effective_from,
      whole_period,repair_period,plan->'base' AS base,plan->'tiers' AS tiers,
      plan->'package_sale' AS package_sale,${sql.raw(CREATED_AT)} AS created_at,created_by`);
  if (row === undefined) throw new Error('The commission plan version insert returned no row');
  return stored(row);
}

export async function auditPlanVersion(
  tx: Tx,
  ids: IdGenerator,
  record: CommissionPlanVersion,
): Promise<void> {
  await appendAuditLog(tx, ids.newId(), {
    entity: 'commission_plan',
    entityId: record.id,
    action: 'commission_plan.version_created',
    after: record,
  });
}
