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

// One snapshot per transaction and business: a consumer that asks for both the columns and the months back (the
// orders read checks the month and projects the fields) must not see two different saves between two SELECTs.
const snapshots = new WeakMap<Tx, Map<string, Promise<StaffColumnsSetting>>>();

/**
 * The public read the consumer adapters call on their own transaction: the effective columns, postponed codes
 * removed, and the effective months back, read once per transaction and business.
 *
 * @param tx         the caller's tenant transaction
 * @param companyId  the verified company
 * @param businessId the business of the staff member's session
 * @returns the allowed columns and months back
 */
export function readStaffColumns(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<StaffColumnsSetting> {
  const perTx = snapshots.get(tx) ?? new Map<string, Promise<StaffColumnsSetting>>();
  snapshots.set(tx, perTx);
  const key = `${companyId}:${businessId}`;
  const cached = perTx.get(key);
  if (cached !== undefined) return cached;
  const read = readStoredStaffColumns(tx, companyId, businessId).then((stored) => ({
    columns: effectiveStaffColumns(stored.columns),
    monthsBack: effectiveStaffMonthsBack(stored.monthsBack),
  }));
  perTx.set(key, read);
  return read;
}

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): StaffColumnsScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    lock: async (businessId) => {
      // القفل الاستشاري بدل صف مبكّر: طلب ما بيغيّرش مايعملش صف، وكتابتين أول مرة بتتقفوا على بعض.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('business_settings:staff_columns:' || ${companyId}::text || ':' || ${businessId}::text, 0))`,
      );
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
      // الكتابة بتعمل الصف لو مش موجود: الطلب اللي غيّر حاجة هو اللي يترك أثر، واللي ما غيّرش مايعملش صف.
      const [row] = await tx.execute<Row>(sql`
        INSERT INTO business_settings (company_id, business_id, staff_columns, staff_months_back, updated_by, updated_at)
        VALUES (${companyId}, ${businessId}, ${columns}, ${value.monthsBack}, ${updatedBy}, now())
        ON CONFLICT (company_id, business_id) DO UPDATE
          SET staff_columns = EXCLUDED.staff_columns,
              staff_months_back = EXCLUDED.staff_months_back,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
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
