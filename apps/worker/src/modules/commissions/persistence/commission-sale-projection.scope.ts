import { reopenReviewedStatementPeriods, type Tx } from '@pospay/db';
import { moneyToString, parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import type { IdGenerator } from '../ports/commission-line-projection.port.ts';
import type { BusinessTimeZoneReader } from './commission-line-projection.scope.ts';
import { lockCommissionPeriods } from './commission-period-locks.ts';
import type { CommissionSaleProjectionRow } from '../domain/commission-sale-inputs.ts';
import type {
  CommissionSaleProjectionScope,
  CommissionSaleProjectionWrite,
} from '../ports/commission-sale-projection.port.ts';

type SaleRow = Omit<CommissionSaleProjectionRow, 'pricePaid' | 'refundedAmount'> & {
  pricePaid: string;
  refundedAmount: string;
};

export function createCommissionSaleProjectionScope(
  tx: Tx,
  businessTimeZone: BusinessTimeZoneReader,
  ids: IdGenerator,
): CommissionSaleProjectionScope {
  return {
    lockSale: async (saleId) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended(app_company_id()::text || ':commission-sale:' || ${saleId}::uuid::text, 0))`);
    },
    readSale: (saleId) => readSale(tx, saleId),
    businessTimeZone: (companyId, businessId) => businessTimeZone(tx, companyId, businessId),
    lockPeriods: (input) => lockCommissionPeriods(tx, input),
    upsertSale: (row) => upsertSale(tx, ids, row),
    reopenReviewed: (input) => reopenReviewedStatementPeriods(tx, input),
  };
}

async function readSale(
  tx: Tx,
  saleId: string,
): Promise<CommissionSaleProjectionRow | null> {
  const [row] = await tx.execute<SaleRow>(sql`SELECT
    business_id AS "businessId",sale_id AS "saleId",branch_id AS "branchId",
    seller_employee_id AS "sellerEmployeeId",business_date::text AS "businessDate",period,
    price_paid::text AS "pricePaid",refunded_amount::text AS "refundedAmount",status,revision
    FROM commission_sales
    WHERE company_id=app_company_id() AND sale_id=${saleId}::uuid`);
  if (row === undefined) return null;
  return {
    ...row,
    pricePaid: parseMoney(row.pricePaid),
    refundedAmount: parseMoney(row.refundedAmount),
  };
}

async function upsertSale(
  tx: Tx,
  ids: IdGenerator,
  row: CommissionSaleProjectionWrite,
): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_sales(
    company_id,id,business_id,sale_id,branch_id,seller_employee_id,business_date,period,
    price_paid,refunded_amount,status,revision)
    VALUES(app_company_id(),${ids.newId()}::uuid,${row.businessId}::uuid,${row.saleId}::uuid,
      ${row.branchId}::uuid,${row.sellerEmployeeId}::uuid,${row.businessDate}::date,${row.period},
      ${moneyToString(row.pricePaid)},${moneyToString(row.refundedAmount)},${row.status},
      ${row.revision})
    ON CONFLICT (company_id,sale_id) DO UPDATE SET
      revision=EXCLUDED.revision,branch_id=EXCLUDED.branch_id,
      seller_employee_id=EXCLUDED.seller_employee_id,business_date=EXCLUDED.business_date,
      period=EXCLUDED.period,price_paid=EXCLUDED.price_paid,
      refunded_amount=EXCLUDED.refunded_amount,status=EXCLUDED.status`);
}
