import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PackageSaleTransactions } from '../ports/package-sale.port.ts';
import { parsePackageSaleRequest } from './package-sale.schema.ts';
import { packageSaleScope } from './package-sale.scope.ts';

// النشر لازم يسلّم مهلة معاملة كاملة مقيسة؛ مفيش افتراضي 15 ثانية لحد ما يتقاس.
export function packageSaleTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  options: { timeoutMs: number },
): PackageSaleTransactions {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new TypeError('timeoutMs must be positive');
  }
  return {
    run: (companyId, requestId, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const request = await loadPackageSaleRequest(tx, companyId, requestId);
          if (request === null) return;
          await tx.execute(
            sql`SELECT set_config('app.user_id',${request.recorded_by},true)`,
          );
          await work(packageSaleScope(tx, ids, companyId, request));
        },
        options,
      ),
    fail: async (companyId, requestId, code, details, at) => {
      await database.withTenant(
        companyId,
        async (tx) => {
          const serialized = details === undefined ? null : JSON.stringify(details);
          await tx.execute(sql`UPDATE package_sale_requests
            SET status='failed',error_code=${code},error_details=${serialized}::jsonb,finished_at=${at}
            WHERE company_id=${companyId} AND id=${requestId} AND status='pending'`);
        },
        options,
      );
    },
  };
}

async function loadPackageSaleRequest(tx: Tx, companyId: string, requestId: string) {
  const [stored] = await tx.execute<Record<string, unknown>>(sql`
    SELECT id,business_id,branch_id,recorded_by,recorded_by_membership_id,discount_limit_bps,
      customer_id,package_type_id,expected_type_revision,expected_service_revisions,
      price_paid::text,paid_method,seller_employee_id,
      to_char(sold_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sold_at,
      to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at
    FROM package_sale_requests
    WHERE company_id=${companyId} AND id=${requestId} AND status='pending' FOR UPDATE`);
  if (stored === undefined) return null;
  return parsePackageSaleRequest(stored);
}
