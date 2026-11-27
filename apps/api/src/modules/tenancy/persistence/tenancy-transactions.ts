import { runIdempotent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import type { Branch } from '@pospay/contracts';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  BranchOpeningHoursScope,
  BusinessCountryScope,
  NewBranch,
  NewBusiness,
  TenancyScope,
  TenancyTransactions,
} from '../ports/tenancy-transactions.port.ts';

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

async function insertBusiness(tx: Tx, companyId: string, b: NewBusiness) {
  const [row] = await tx.execute<{ created_at: string }>(sql`
    INSERT INTO businesses (id, company_id, vertical_type, name_en, name_ar, currency, timezone, settings)
    VALUES (${b.id}, ${companyId}, ${b.verticalType}, ${b.nameEn}, ${b.nameAr}, ${b.currency}, ${b.timezone},
            ${jsonb(b.settings)})
    RETURNING to_json(created_at) #>> '{}' AS created_at`);
  if (row === undefined) throw new Error('insert returned no row');
  return { createdAt: row.created_at };
}

async function lockBusinessSettings(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<Record<string, unknown> | null> {
  // صف مفقود يعني null (نشاط مش مرئي)، أما settings الفارغة أو غير الكائن (إرث قبل هذا التسليم)
  // فتُقرأ كائناً فارغاً تحت نفس القفل، فالدمج يبدأ من {} ولا يفسد أي قيمة غير كائنية.
  const [row] = await tx.execute<{ settings: Record<string, unknown> | null }>(sql`
    SELECT CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END AS settings
    FROM businesses
    WHERE company_id = ${companyId} AND id = ${businessId}
    FOR NO KEY UPDATE`);
  return row?.settings ?? null;
}

async function saveBusinessCountry(
  tx: Tx,
  companyId: string,
  businessId: string,
  country: string,
): Promise<void> {
  // الدمج على مستوى قاعدة البيانات: مفتاح country فقط بيتضاف أو بيتبدل، وكل مفتاح تاني بيفضل مخزّناً؛
  // والإرث غير الكائني يبدأ من {} بدل إلحاق كائن بمصفوفة أو قيمة.
  await tx.execute(sql`
    UPDATE businesses
    SET settings = CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END
                  || jsonb_build_object('country', ${country}::text)
    WHERE company_id = ${companyId} AND id = ${businessId}`);
}

async function lockBranchOpeningHours(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<{ readonly openingHours: unknown } | null> {
  // الفرع لازم يبقى تحت النشاط اللي الصلاحية اتقيّمت عنده: فرع نشاط تاني في نفس الشركة بيرجع null (نفس 404).
  const [row] = await tx.execute<{ opening_hours: unknown }>(sql`
    SELECT opening_hours FROM branches
    WHERE company_id = ${companyId} AND business_id = ${businessId} AND id = ${branchId}
    FOR NO KEY UPDATE`);
  return row === undefined ? null : { openingHours: row.opening_hours };
}

async function saveBranchOpeningHours(
  tx: Tx,
  companyId: string,
  branchId: string,
  openingHours: unknown,
): Promise<void> {
  await tx.execute(sql`
    UPDATE branches
    SET opening_hours = ${openingHours === null ? null : jsonb(openingHours)}
    WHERE company_id = ${companyId} AND id = ${branchId}`);
}

async function readStoredBranch(tx: Tx, companyId: string, branchId: string): Promise<Branch> {
  const [row] = Array.from(
    await tx.execute<Branch>(sql`
      SELECT b.id, b.company_id, b.business_id, b.name_ar, b.name_en, b.address_ar, b.address_en,
             CASE WHEN b.geo_lat IS NULL THEN NULL
                  ELSE json_build_object('lat', b.geo_lat, 'lng', b.geo_lng) END AS geo,
             b.opening_hours, b.timezone,
             COALESCE(b.timezone, bu.timezone) AS effective_timezone,
             b.is_active, to_json(b.created_at) #>> '{}' AS created_at
      FROM branches b
      JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
      WHERE b.company_id = ${companyId} AND b.id = ${branchId}`),
  );
  if (row === undefined) throw new Error('branch vanished under its own lock');
  return row;
}

async function insertBranch(tx: Tx, companyId: string, b: NewBranch) {
  const [row] = await tx.execute<{ created_at: string; business_timezone: string }>(sql`
    INSERT INTO branches (id, company_id, business_id, name_en, name_ar, address_ar, address_en,
                          geo_lat, geo_lng, opening_hours, timezone)
    VALUES (${b.id}, ${companyId}, ${b.businessId}, ${b.nameEn}, ${b.nameAr}, ${b.addressAr}, ${b.addressEn},
            ${b.geo?.lat ?? null}, ${b.geo?.lng ?? null},
            ${b.openingHours === null ? null : jsonb(b.openingHours)}, ${b.timeZone})
    RETURNING to_json(created_at) #>> '{}' AS created_at,
              (SELECT timezone FROM businesses
               WHERE company_id = ${companyId} AND id = ${b.businessId}) AS business_timezone`);
  if (row === undefined) throw new Error('insert returned no row');
  return { createdAt: row.created_at, businessTimeZone: row.business_timezone };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for audit and outbox rows
 * @returns withTenant for the verified company + a COMPANY-scoped idempotency claim, around the work
 */
export function createTenancyTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): TenancyTransactions {
  return {
    run: ({ companyId, userId, operation }, idempotency, work) =>
      db.withTenant(
        companyId,
        (tx) =>
          runIdempotent(tx, { scope: 'COMPANY', operation, ...idempotency }, () => {
            const scope: TenancyScope = {
              companyId,
              ...transactionWriters(tx, ids),
              insertBusiness: (business) => insertBusiness(tx, companyId, business),
              insertBranch: (branch) => insertBranch(tx, companyId, branch),
            };
            return work(scope);
          }),
        { userId },
      ),
    runBusinessCountryChange: ({ companyId, userId }, work) =>
      db.withTenant(
        companyId,
        (tx) => {
          const scope: BusinessCountryScope = {
            companyId,
            ...transactionWriters(tx, ids),
            lockBusinessCountry: (businessId) => lockBusinessSettings(tx, companyId, businessId),
            saveBusinessCountry: (businessId, country) =>
              saveBusinessCountry(tx, companyId, businessId, country),
          };
          return work(scope);
        },
        { userId },
      ),
    runBranchOpeningHoursChange: ({ companyId, userId }, work) =>
      db.withTenant(
        companyId,
        (tx) => {
          const scope: BranchOpeningHoursScope = {
            companyId,
            ...transactionWriters(tx, ids),
            lockBranchOpeningHours: (businessId, branchId) =>
              lockBranchOpeningHours(tx, companyId, businessId, branchId),
            saveBranchOpeningHours: (branchId, openingHours) =>
              saveBranchOpeningHours(tx, companyId, branchId, openingHours),
            readBranch: (branchId) => readStoredBranch(tx, companyId, branchId),
          };
          return work(scope);
        },
        { userId },
      ),
  };
}
