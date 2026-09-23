import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { CashierPinScope, CashierPinTransactions } from '../ports/cashier-pins.port.ts';

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): CashierPinScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    findHash: async (employeeId) => {
      const [row] = await tx.execute<{ pin_hash: string }>(sql`
        SELECT pin_hash FROM cashier_pins WHERE company_id = ${companyId} AND employee_id = ${employeeId}`);
      return row?.pin_hash ?? null;
    },
    save: async (pin) => {
      const [row] = await tx.execute<{ created: boolean }>(sql`
        INSERT INTO cashier_pins (company_id, id, employee_id, pin_hash, set_by, set_at)
        VALUES (${companyId}, ${ids.newId()}, ${pin.employeeId}, ${pin.pinHash}, ${pin.setBy},
                ${pin.setAt.toISOString()}::timestamptz)
        ON CONFLICT (company_id, employee_id) DO UPDATE
          SET pin_hash = EXCLUDED.pin_hash, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at
        RETURNING xmax = 0 AS created`);
      return row?.created === true ? 'created' : 'replaced';
    },
  };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for PIN and audit rows
 * @returns withTenant for the PIN's company around the PIN work
 */
export function createCashierPinTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): CashierPinTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(
        companyId,
        (tx) => work(scopeFor(tx, companyId, ids)),
        userId === null ? {} : { userId },
      ),
  };
}
