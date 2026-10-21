import { runIdempotent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import {
  effectiveStaffColumns,
  effectiveStaffMonthsBack,
  type StaffColumnCode,
} from '../domain/staff-columns.ts';
import type {
  StaffColumnsScope,
  StaffColumnsTransactions,
  StoredStaffColumns,
} from '../ports/staff-columns-settings.port.ts';

type Row = { staff_columns: string[] | null; staff_months_back: number | null };

const toStored = (row: Row | undefined): StoredStaffColumns => ({
  columns: row?.staff_columns ?? null,
  monthsBack: row?.staff_months_back ?? null,
});

/** The staff-app columns and months back every "my" read applies (spec 060 FR-A08). */
export interface StaffColumnsSetting {
  readonly columns: readonly StaffColumnCode[];
  readonly monthsBack: number;
}

/**
 * The stored setting without a lock; a missing row is the defaults, and the read never creates one.
 *
 * @param tx         the caller's tenant transaction
 * @param companyId  the verified company
 * @param businessId the business
 * @returns what is stored, nulls when nothing is
 */
async function readStoredStaffColumns(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<StoredStaffColumns> {
  const [row] = await tx.execute<Row>(sql`
    SELECT staff_columns, staff_months_back FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  return toStored(row);
}

/**
 * The public read the consumer adapters call on their own transaction: the effective columns, postponed codes
 * removed, and the effective months back.
 *
 * @param tx         the caller's tenant transaction
 * @param companyId  the verified company
 * @param businessId the business of the staff member's session
 * @returns the allowed columns and months back
 */
export async function readStaffColumns(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<StaffColumnsSetting> {
  const stored = await readStoredStaffColumns(tx, companyId, businessId);
  return {
    columns: effectiveStaffColumns(stored.columns),
    monthsBack: effectiveStaffMonthsBack(stored.monthsBack),
  };
}

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): StaffColumnsScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    lock: async (businessId) => {
      // The row is created first so two first writes queue on it instead of both auditing "nothing yet".
      await tx.execute(sql`
        INSERT INTO business_settings (company_id, business_id) VALUES (${companyId}, ${businessId})
        ON CONFLICT (company_id, business_id) DO NOTHING`);
      const [row] = await tx.execute<Row>(sql`
        SELECT staff_columns, staff_months_back FROM business_settings
        WHERE company_id = ${companyId} AND business_id = ${businessId} FOR UPDATE`);
      return toStored(row);
    },
    save: async (businessId, value, updatedBy) => {
      const columns =
        value.columns === null
          ? null
          : sql`ARRAY[${sql.join(
              value.columns.map((code) => sql`${code}`),
              sql`,`,
            )}]::text[]`;
      const [row] = await tx.execute<Row>(sql`
        UPDATE business_settings
        SET staff_columns = ${columns}, staff_months_back = ${value.monthsBack},
            updated_by = ${updatedBy}, updated_at = now()
        WHERE company_id = ${companyId} AND business_id = ${businessId}
        RETURNING staff_columns, staff_months_back`);
      if (row === undefined) throw new Error('staff columns update returned no row');
      return toStored(row);
    },
  };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for audit rows
 * @returns withTenant and the Idempotency-Key claim around the staff-columns replacement
 */
export function createStaffColumnsTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): StaffColumnsTransactions {
  return {
    run: (command, work) =>
      db.withTenant(
        command.companyId,
        async (tx) => {
          const result = await runIdempotent(
            tx,
            {
              scope: 'COMPANY',
              operation: 'replace-staff-columns',
              key: command.key,
              fingerprint: command.fingerprint,
            },
            async () => ({ status: 200, body: await work(scopeFor(tx, command.companyId, ids)) }),
          );
          return result.body as Awaited<ReturnType<typeof work>>;
        },
        { userId: command.userId },
      ),
  };
}
