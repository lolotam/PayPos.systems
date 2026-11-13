import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// النسخة العاملة من apps/api/src/modules/customers/persistence/session-customer.reader.ts لإثبات عميلة البيع فقط.
export async function packageSaleCustomerExists(
  tx: Tx,
  companyId: string,
  customerId: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM customers WHERE company_id=${companyId} AND id=${customerId}`);
  return row !== undefined;
}
