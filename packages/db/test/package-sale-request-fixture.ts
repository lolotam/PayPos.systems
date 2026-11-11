import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

import { ORDER_IDS } from './orders-fixture.ts';
import { TENANT, USER } from './tenancy-fixtures.ts';

export type SaleRequestTenant = { company: string; business: string; branch: string };

/**
 * بيدخّل طلب بيع معلق صالح ويرجّع الـ id؛ كل اختبار بيغيّر بس العمود اللي بيختبره عن طريق overrides،
 * عشان الرفض اللي بيظهر يبقى سببه التغيير ده مش عمود تاني ناقص.
 */
export async function insertSaleRequest(
  tx: postgres.TransactionSql,
  overrides: Record<string, unknown> = {},
  tenant: SaleRequestTenant = TENANT.A,
): Promise<string> {
  const row = {
    company_id: tenant.company,
    id: randomUUID(),
    business_id: tenant.business,
    branch_id: tenant.branch,
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
    discount_limit_bps: 1000,
    customer_id: ORDER_IDS.customer,
    package_type_id: randomUUID(),
    expected_type_revision: 1,
    expected_service_revisions: tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }]),
    price_paid: '25.000',
    paid_method: 'CASH',
    seller_employee_id: ORDER_IDS.employee,
    sold_at: new Date(),
    recorded_at: new Date(),
    status: 'pending',
    ...overrides,
  };
  await tx`INSERT INTO package_sale_requests ${tx(row)}`;
  return String(row.id);
}
