import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { packageSellerEligible } from '../domain/package-seller-eligibility.ts';
import type { PackageSellerAttachment } from '../domain/package-seller-eligibility.ts';

type SellerRow = {
  id: string;
  user_id: string | null;
  hire_date: string;
  contract_end: string | null;
  deleted_at: string | null;
  attachments: readonly PackageSellerAttachment[];
};

// النسخة العاملة من apps/api/src/modules/staff/persistence/session-performers.reader.ts لقفل بائعة الباقة وقراءتها.
export async function lockPackageSeller(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=ANY(ARRAY[${employeeId}]::uuid[]) ORDER BY id FOR SHARE`);
}

export async function readPackageSeller(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  employeeId: string,
  businessDate: string,
) {
  const [row] = await tx.execute<SellerRow>(sql`
    SELECT e.id,e.user_id,e.hire_date::text,e.contract_end::text,e.deleted_at::text,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',eb.branch_id,'from',eb."from",'to',eb."to"))
        FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.business_id=e.business_id
          AND eb.employee_id=e.id AND eb.branch_id=${branchId}),'[]'::jsonb) AS attachments
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.id=ANY(ARRAY[${employeeId}]::uuid[]) ORDER BY e.id`);
  if (row === undefined) return undefined;
  return {
    id: row.id,
    user_id: row.user_id,
    eligible: packageSellerEligible(row, branchId, businessDate),
  };
}
