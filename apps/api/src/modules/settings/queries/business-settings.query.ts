import type { BusinessSettings } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** What this read needs from the cache — the Redis adapter satisfies it (a query may not import ports/). */
export interface SettingsReadCache {
  get(companyId: string, businessId: string): Promise<string | null>;
  set(companyId: string, businessId: string, json: string): Promise<void>;
}

/** The template values the read falls back to — handed in by the module wiring, from domain/business-settings.ts. */
export interface SettingsTemplate {
  readonly defaultLanguage: string;
  readonly calendar: string;
}

/**
 * @param db       the tenant wrappers
 * @param cache    the settings read cache
 * @param template the template values a business has not changed
 * @param access   the verified company and the caller
 * @param access.companyId the verified company
 * @param access.userId    the caller
 * @param businessId the business the guard authorized
 * @returns the business's effective settings
 */
export async function businessSettingsQuery(
  db: TenantWrappers,
  cache: SettingsReadCache,
  template: SettingsTemplate,
  access: { companyId: string; userId: string },
  businessId: string,
): Promise<BusinessSettings> {
  const cached = await cache.get(access.companyId, businessId);
  if (cached !== null) return JSON.parse(cached) as BusinessSettings;
  // Screen: admin › business settings. One business by its key; no row yet means every value is the template's.
  const [row] = await db.withTenant(
    access.companyId,
    async (tx) =>
      Array.from(
        await tx.execute<BusinessSettings>(sql`
          SELECT ${businessId}::uuid AS business_id,
                 COALESCE(s.default_language, ${template.defaultLanguage}) AS default_language,
                 COALESCE(s.calendar, ${template.calendar}) AS calendar,
                 s.tax_rule,
                 array_remove(ARRAY[
                   CASE WHEN s.default_language IS NOT NULL THEN 'default_language' END,
                   CASE WHEN s.calendar IS NOT NULL THEN 'calendar' END
                 ], NULL) AS overridden,
                 to_json(s.updated_at) #>> '{}' AS updated_at
          FROM (SELECT 1) AS one
          LEFT JOIN business_settings s
            ON s.company_id = ${access.companyId} AND s.business_id = ${businessId}`),
      ),
    { userId: access.userId },
  );
  if (row === undefined) throw new Error('settings query returned no row');
  await cache.set(access.companyId, businessId, JSON.stringify(row));
  return row;
}
