import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { maskPhone } from '../domain/phone.ts';

export async function readSessionCustomer(tx: Tx, companyId: string, customerId: string) {
  const [row] = await tx.execute<{ id: string; name: string; phone: string }>(sql`
    SELECT id,name,phone FROM customers WHERE company_id=${companyId} AND id=${customerId}`);
  return row === undefined ? null : { id: row.id, name: row.name, phone_masked: maskPhone(row.phone) };
}
