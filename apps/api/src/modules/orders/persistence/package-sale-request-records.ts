import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PendingPackageSaleRequest } from '../domain/package-sale-request.ts';

export async function insertPendingPackageSale(
  tx: Tx,
  request: PendingPackageSaleRequest,
): Promise<void> {
  const soldAt = request.sold_at?.toISOString() ?? null;
  await tx.execute(sql`
    INSERT INTO package_sale_requests
      (company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
        discount_limit_bps, customer_id, package_type_id, expected_type_revision,
        expected_service_revisions, price_paid, paid_method, seller_employee_id, sold_at,
        recorded_at, status)
    VALUES
      (${request.company_id}::uuid, ${request.id}::uuid, ${request.business_id}::uuid,
        ${request.branch_id}::uuid, ${request.recorded_by}::uuid,
        ${request.recorded_by_membership_id}::uuid, ${request.discount_limit_bps},
        ${request.customer_id}::uuid, ${request.package_type_id}::uuid,
        ${request.expected_type_revision}, ${JSON.stringify(request.expected_service_revisions)}::jsonb,
        ${request.price_paid}::numeric(14,3), ${request.paid_method},
        ${request.seller_employee_id}::uuid, ${soldAt}::timestamptz,
        ${request.recorded_at.toISOString()}::timestamptz, ${request.status})`);
}
