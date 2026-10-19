import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { LogoFileRejected } from '../domain/logo-file.ts';
import { OfficialNameRejected } from '../domain/official-name.ts';
import type {
  IdentityNamesChange,
  SettingsChange,
  SettingsScope,
  SettingsTransactions,
  StoredSettings,
} from '../ports/settings.port.ts';
import { createBusinessDiscountAccess } from './business-discount-access.adapter.ts';
import { createBusinessIdentityAccess } from './business-identity-access.adapter.ts';
import { createLogoFileReader } from './logo-file.adapter.ts';

type Row = {
  limit_bps: number | null;
  default_language: StoredSettings['defaultLanguage'];
  calendar: StoredSettings['calendar'];
  tax_rule: unknown;
  official_name_ar: string | null;
  official_name_en: string | null;
  logo_file_id: string | null;
  updated_at: string;
};

const COLUMNS = sql`default_language, calendar, limit_bps, tax_rule, official_name_ar, official_name_en, logo_file_id, to_json(updated_at) #>> '{}' AS updated_at`;
const toStored = (row: Row): StoredSettings => ({
  limitBps: row.limit_bps,
  defaultLanguage: row.default_language,
  calendar: row.calendar,
  taxRule: row.tax_rule,
  officialNameAr: row.official_name_ar,
  officialNameEn: row.official_name_en,
  logoFileId: row.logo_file_id,
  updatedAt: row.updated_at,
});

function scopeFor(tx: Tx, companyId: string, userId: string, ids: IdGenerator): SettingsScope {
  const writers = transactionWriters(tx, ids);
  return {
    discountAccess: createBusinessDiscountAccess(tx, companyId, userId),
    identityAccess: createBusinessIdentityAccess(tx, companyId, userId),
    audit: writers.audit,
    outbox: writers.outbox,
    logoFiles: createLogoFileReader(tx, companyId),
    findForUpdate: async (businessId) => {
      // A row that does not exist cannot be locked: two first writes would both read "nothing yet" and audit a wrong
      // before. Creating the empty row first (every value the template's) gives the second writer a row to wait on.
      const created = await tx.execute<{ business_id: string }>(sql`
        INSERT INTO business_settings (company_id, business_id)
        VALUES (${companyId}, ${businessId})
        ON CONFLICT (company_id, business_id) DO NOTHING
        RETURNING business_id`);
      const [row] = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM business_settings
        WHERE company_id = ${companyId} AND business_id = ${businessId}
        FOR UPDATE`);
      return row === undefined || created.length > 0 ? null : toStored(row);
    },
    save: async (businessId, change: SettingsChange, updatedBy) => {
      const updates: SQL[] = [
        ...('defaultLanguage' in change ? [sql`default_language = EXCLUDED.default_language`] : []),
        ...('calendar' in change ? [sql`calendar = EXCLUDED.calendar`] : []),
        ...('limitBps' in change ? [sql`limit_bps = EXCLUDED.limit_bps`] : []),
      ];
      const [row] = await tx.execute<Row>(sql`
        INSERT INTO business_settings (company_id, business_id, default_language, calendar, limit_bps, updated_by, updated_at)
        VALUES (${companyId}, ${businessId}, ${change.defaultLanguage ?? null}, ${change.calendar ?? null}, ${change.limitBps ?? null},
                ${updatedBy}, now())
        ON CONFLICT (company_id, business_id) DO UPDATE
          SET ${sql.join([...updates, sql`updated_by = EXCLUDED.updated_by`, sql`updated_at = now()`], sql`, `)}
        RETURNING ${COLUMNS}`);
      if (row === undefined) throw new Error('upsert returned no row');
      return toStored(row);
    },
    saveIdentity: (businessId, change, updatedBy) =>
      saveIdentityNames(tx, companyId, businessId, change, updatedBy),
    saveLogo: (businessId, logoFileId, updatedBy) =>
      saveLogoFile(tx, companyId, businessId, logoFileId, updatedBy),
  };
}

function postgresConstraint(error: unknown): { code?: string; constraint: string } {
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause !== 'object' || cause === null) return { constraint: '' };
  const code = 'code' in cause ? cause.code : undefined;
  const constraint = 'constraint_name' in cause ? String(cause.constraint_name) : '';
  return typeof code === 'string' ? { code, constraint } : { constraint };
}

async function saveLogoFile(
  tx: Tx,
  companyId: string,
  businessId: string,
  logoFileId: string | null,
  updatedBy: string,
): Promise<StoredSettings> {
  try {
    const [row] = await tx.execute<Row>(sql`
      UPDATE business_settings
      SET logo_file_id = ${logoFileId}, updated_by = ${updatedBy}, updated_at = now()
      WHERE company_id = ${companyId} AND business_id = ${businessId}
      RETURNING ${COLUMNS}`);
    if (row === undefined) throw new Error('logo update returned no row');
    return toStored(row);
  } catch (error) {
    const { code, constraint } = postgresConstraint(error);
    if ((code === '23505' || code === '23503') && constraint.includes('logo_file')) {
      throw new LogoFileRejected('FILE_NOT_FOUND');
    }
    throw error;
  }
}

async function saveIdentityNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  change: IdentityNamesChange,
  updatedBy: string,
): Promise<StoredSettings> {
  const updates: SQL[] = [
    ...('officialNameAr' in change ? [sql`official_name_ar = ${change.officialNameAr ?? null}`] : []),
    ...('officialNameEn' in change ? [sql`official_name_en = ${change.officialNameEn ?? null}`] : []),
    sql`updated_by = ${updatedBy}`,
    sql`updated_at = now()`,
  ];
  try {
    const [row] = await tx.execute<Row>(sql`
      UPDATE business_settings
      SET ${sql.join(updates, sql`, `)}
      WHERE company_id = ${companyId} AND business_id = ${businessId}
      RETURNING ${COLUMNS}`);
    if (row === undefined) throw new Error('identity update returned no row');
    return toStored(row);
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : error;
    const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
    const constraint =
      typeof cause === 'object' && cause !== null && 'constraint_name' in cause
        ? String(cause.constraint_name)
        : '';
    if (code === '23514' && constraint.startsWith('business_settings_official_name_')) {
      throw new OfficialNameRejected();
    }
    throw error;
  }
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
      db.withTenant(companyId, (tx) => work(scopeFor(tx, companyId, userId, ids)), { userId }),
  };
}
