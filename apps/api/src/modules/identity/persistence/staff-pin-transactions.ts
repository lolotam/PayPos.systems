import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { StaffPinScope, StaffPinTransactions } from '../ports/staff-pins.port.ts';

function scope(tx: Tx, companyId: string, ids: IdGenerator): StaffPinScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    member: async (userId) => {
      const rows = await tx.execute(sql`SELECT 1 FROM memberships WHERE company_id=${companyId}
        AND user_id=${userId} AND starts_at<=clock_timestamp()
        AND (ends_at IS NULL OR ends_at>clock_timestamp()) LIMIT 1`);
      return rows.length !== 0;
    },
    find: async (userId) => {
      const [row] = await tx.execute<{ id: string; hash: string }>(sql`
        SELECT id,pin_hash AS hash FROM cashier_pins WHERE company_id=${companyId} AND user_id=${userId}`);
      return row ?? null;
    },
    save: async (userId, hash, actor, at) => {
      await tx.execute(sql`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at)
        VALUES(${companyId},${ids.newId()},${userId},${hash},${actor},${at.toISOString()}::timestamptz)
        ON CONFLICT(company_id,user_id) DO UPDATE SET id=EXCLUDED.id,pin_hash=EXCLUDED.pin_hash,
          set_by=EXCLUDED.set_by,set_at=EXCLUDED.set_at`);
    },
  };
}

/** RLS وpospay_app كما هما؛ المصادقة لا تحصل على grants لهذا الجدول. */
export function createStaffPinTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): StaffPinTransactions {
  return {
    run: (companyId, actor, work) =>
      db.withTenant(
        companyId,
        (tx) => work(scope(tx, companyId, ids)),
        actor === null ? {} : { userId: actor },
      ),
  };
}
