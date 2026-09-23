import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  SettingsChange,
  SettingsScope,
  SettingsTransactions,
  StoredSettings,
} from '../ports/settings.port.ts';

type Row = {
  default_language: StoredSettings['defaultLanguage'];
  calendar: StoredSettings['calendar'];
  tax_rule: unknown;
  updated_at: string;
};

const COLUMNS = sql`default_language, calendar, tax_rule, to_json(updated_at) #>> '{}' AS updated_at`;
const toStored = (row: Row): StoredSettings => ({
  defaultLanguage: row.default_language,
  calendar: row.calendar,
  taxRule: row.tax_rule,
  updatedAt: row.updated_at,
});

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): SettingsScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    findForUpdate: async (businessId) => {
      const [row] = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM business_settings
        WHERE company_id = ${companyId} AND business_id = ${businessId}
        FOR UPDATE`);
      return row === undefined ? null : toStored(row);
    },
    save: async (businessId, change: SettingsChange, updatedBy) => {
      const updates: SQL[] = [
        ...('defaultLanguage' in change ? [sql`default_language = EXCLUDED.default_language`] : []),
        ...('calendar' in change ? [sql`calendar = EXCLUDED.calendar`] : []),
      ];
      const [row] = await tx.execute<Row>(sql`
        INSERT INTO business_settings (company_id, business_id, default_language, calendar, updated_by, updated_at)
        VALUES (${companyId}, ${businessId}, ${change.defaultLanguage ?? null}, ${change.calendar ?? null},
                ${updatedBy}, now())
        ON CONFLICT (company_id, business_id) DO UPDATE
          SET ${sql.join([...updates, sql`updated_by = EXCLUDED.updated_by`, sql`updated_at = now()`], sql`, `)}
        RETURNING ${COLUMNS}`);
      if (row === undefined) throw new Error('upsert returned no row');
      return toStored(row);
    },
  };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for audit rows
 * @returns withTenant for the verified company around the settings work
 */
export function createSettingsTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): SettingsTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(companyId, (tx) => work(scopeFor(tx, companyId, ids)), { userId }),
  };
}
