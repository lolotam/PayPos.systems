import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CustomerRecord } from '../domain/customer.ts';
import type {
  CustomerTransactions,
  NewCustomer,
  NewCustomerNote,
} from '../ports/customer-transactions.port.ts';
import type { BranchBusinessReader } from './workspace-names.adapter.ts';

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  locale: 'ar' | 'en';
  opted_out_at: Date | null;
};

class CustomerPersistenceError extends Error {
  constructor() {
    super('CUSTOMER_PERSISTENCE_FAILED');
    this.name = 'CustomerPersistenceError';
  }
}

// أخطاء Drizzle تحمل الهاتف في params والـ stack؛ لا نعبر الحد بأي جزء من خطأ السائق.
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new CustomerPersistenceError();
  }
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    locale: row.locale,
    optedOutAt: row.opted_out_at,
  };
}

async function findByPhone(
  tx: Tx,
  companyId: string,
  phone: string,
): Promise<CustomerRecord | null> {
  const [row] = await tx.execute<CustomerRow>(sql`
    SELECT id, name, phone, locale, opted_out_at FROM customers
    WHERE company_id = ${companyId} AND phone = ${phone}`);
  return row === undefined ? null : mapCustomer(row);
}

async function create(
  tx: Tx,
  companyId: string,
  input: NewCustomer,
): Promise<{ customer: CustomerRecord; created: boolean }> {
  const at = input.at.toISOString();
  // حقول الملف الشخصي بتتكتب صراحةً؛ اللي مش مبعوت بيفضل NULL (S-1).
  const [inserted] = await tx.execute<CustomerRow>(sql`
    INSERT INTO customers (company_id, id, name, phone, locale, birth_month, birth_day, birth_year, gender, email, created_at, updated_at)
    VALUES (${companyId}, ${input.id}, ${input.name}, ${input.phone}, ${input.locale},
      ${input.birthday?.month ?? null}, ${input.birthday?.day ?? null}, ${input.birthday?.year ?? null},
      ${input.gender ?? null}, ${input.email ?? null}, ${at}, ${at})
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

async function addNote(tx: Tx, companyId: string, note: NewCustomerNote): Promise<void> {
  await tx.execute(sql`
    INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${companyId}, ${note.customerId}, ${note.businessId}, ${note.note}, ${note.at.toISOString()})`);
}

export function createCustomerTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
  branchBusiness: BranchBusinessReader,
): CustomerTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      let thrownByWork: unknown;
      try {
        return await db.withTenant(
          companyId,
          async (tx) => {
            try {
              return await work({
                findByPhone: (phone) => safely(() => findByPhone(tx, companyId, phone)),
                create: (customer) => safely(() => create(tx, companyId, customer)),
                addNote: (note) => safely(() => addNote(tx, companyId, note)),
                branchBusiness: (branchId) => safely(() => branchBusiness.business(tx, branchId)),
                audit: { record: (entry) => safely(() => appendAuditLog(tx, ids.newId(), entry)) },
              });
            } catch (error) {
              thrownByWork = error;
              throw error;
            }
          },
          { userId },
        );
      } catch (error) {
        // خطأ الـ use case نفسه (خطأ domain مسمّى أو خطأ سائق اتنضّف فوق) يعدّي كما هو عشان الـ controller
        // يرجّع 400 مش 500؛ أي خطأ تاني من غلاف المعاملة نفسه بيتنضّف.
        if (error === thrownByWork) throw error;
        throw new CustomerPersistenceError();
      }
    },
  };
}
