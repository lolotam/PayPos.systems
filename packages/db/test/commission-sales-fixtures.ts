import { sql } from 'drizzle-orm';
import { systemUuidV7 } from '@pospay/ids';

import type { Tx } from '../src/index.ts';
import type { CommissionTenant } from './commission-statement-fixtures.ts';

export const saleIds = systemUuidV7();

/** ينشئ صف بيع باقة صالحًا في إسقاط العمولة، مع تجاوزات محدودة لاختبار القيود والعزل. */
export function insertCommissionSale(
  tx: Tx,
  tenant: CommissionTenant,
  overrides: Record<string, string | number> = {},
) {
  const row = {
    company: tenant.company,
    business: tenant.business,
    branch: tenant.branch,
    employee: tenant.employee,
    id: saleIds.newId(),
    sale: saleIds.newId(),
    businessDate: '2026-11-01',
    period: '2026-11',
    pricePaid: '30.000',
    refundedAmount: '0.000',
    status: 'SOLD',
    revision: 1,
    ...overrides,
  };
  return tx.execute(sql`
    INSERT INTO commission_sales(company_id,id,business_id,sale_id,branch_id,seller_employee_id,
      business_date,period,price_paid,refunded_amount,status,revision)
    VALUES(${row.company},${row.id},${row.business},${row.sale},${row.branch},${row.employee},
      ${row.businessDate},${row.period},${row.pricePaid},${row.refundedAmount},${row.status},${row.revision})`);
}
