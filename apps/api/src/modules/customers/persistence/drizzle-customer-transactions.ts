import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CustomerRecord } from '../domain/customer.ts';
import type { CustomerTransactions, NewCustomer } from '../ports/customer-transactions.port.ts';

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  locale: 'ar' | 'en';
  opted_out_at: Date | null;
};

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    locale: row.locale,
    optedOutAt: row.opted_out_at,
  };
}

async function findOrCreate(tx: Tx, companyId: string, input: NewCustomer) {
  const at = input.at.toISOString();
  const [inserted] = await tx.execute<CustomerRow>(sql`
    INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${input.id}, ${input.name}, ${input.phone}, ${input.locale}, ${at}, ${at})
    ON CONFLICT (company_id, phone) DO NOTHING
    RETURNING id, name, phone, locale, opted_out_at`);
  if (inserted !== undefined) return { customer: mapCustomer(inserted), created: true };
  // التعارض ينتظر COMMIT للمنافس؛ statement منفصل يرى الصف الفائز تحت READ COMMITTED دون تحديث بياناته.
  const [existing] = await tx.execute<CustomerRow>(sql`
    SELECT id, name, phone, locale, opted_out_at FROM customers
    WHERE company_id = ${companyId} AND phone = ${input.phone}`);
  if (existing === undefined) throw new Error('CUSTOMER_CONFLICT_WITHOUT_ROW');
  return { customer: mapCustomer(existing), created: false };
}

export function createCustomerTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): CustomerTransactions {
  return {
    run: ({ companyId, userId }, work) =>
      db.withTenant(
        companyId,
        (tx) =>
          work({
            findOrCreate: (customer) => findOrCreate(tx, companyId, customer),
            audit: { record: (entry) => appendAuditLog(tx, ids.newId(), entry) },
          }),
        { userId },
      ),
  };
}
