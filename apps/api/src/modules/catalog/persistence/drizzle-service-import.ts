import { sql } from 'drizzle-orm';
import type { TenantWrappers, Tx } from '@pospay/db';

import { normalizeServiceCategoryName } from '../domain/service-category.ts';
import type { ServiceImportFileFacts } from '../domain/service-import-file.ts';
import { ServiceImportError } from '../domain/errors.ts';
import type {
  SaveServiceImportPreviewInput,
  ServiceImportCategoryMatch,
  ServiceImportFileFactsPort,
  ServiceImportTransactions,
} from '../ports/service-import.port.ts';

/** تصنيفات النشاط المفتوحة للاستعلام المشترك بين القالب والمعاينة (FR-004). */
async function readOpenCategories(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<readonly { id: string; name_en: string; name_ar: string | null }[]> {
  return tx.execute(sql`
    SELECT id, name_en, name_ar
    FROM service_categories
    WHERE company_id = ${companyId}
      AND business_id = ${businessId}
      AND closed_at IS NULL
    ORDER BY name_en`);
}

/** نصوص التصنيفات تُطابَق دفعة واحدة على التصنيفات المفتوحة بمساواة الفهرس نفسها (A-12). */
async function matchCategoryLabels(
  tx: Tx,
  companyId: string,
  businessId: string,
  labels: readonly string[],
): Promise<readonly ServiceImportCategoryMatch[]> {
  if (labels.length === 0) return [];
  const lookups = labels.map((label) => normalizeServiceCategoryName(label));
  const rows = await tx.execute<{ label: string; id: string; name_en: string }>(sql`
    WITH input AS (
      SELECT label, lower(label) AS lookup_key
      FROM unnest(ARRAY[${sql.join(lookups.map((label) => sql`${label}`), sql`, `)}]::text[])
        WITH ORDINALITY AS t(label, ord)
    )
    SELECT i.label, c.id, c.name_en
    FROM input i
    JOIN service_categories c
      ON c.company_id = ${companyId}
     AND c.business_id = ${businessId}
     AND lower(c.name_en) = i.lookup_key
     AND c.closed_at IS NULL`);
  // المفتاح الفريد على (الشركة، النشاط، lower(name_en)) يضمن حلّاً واحداً لكل نص قانوني.
  const byLabel = new Map(rows.map((row) => [normalizeServiceCategoryName(row.label), row]));
  return labels.flatMap((label) => {
    const row = byLabel.get(normalizeServiceCategoryName(label));
    return row === undefined
      ? []
      : [{ label, id: row.id, nameEn: row.name_en }];
  });
}

/** القراءة الحاسمة للأسماء داخل النشاط، المفتوحة والمقفولة معاً بمفاتيح المماسّر نفسها (A-11). */
async function readExistingServiceKeys(
  tx: Tx,
  companyId: string,
  businessId: string,
  keys: readonly string[],
): Promise<readonly string[]> {
  if (keys.length === 0) return [];
  const rows = await tx.execute<{ key: string }>(sql`
    SELECT DISTINCT lower(name_en) AS key
    FROM services
    WHERE company_id = ${companyId}
      AND business_id = ${businessId}
      AND lower(name_en) = ANY(ARRAY[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}]::text[])`);
  return rows.map((row) => row.key);
}

async function savePreview(
  tx: Tx,
  companyId: string,
  userId: string,
  input: SaveServiceImportPreviewInput,
): Promise<void> {
  await tx.execute(sql`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${companyId},${input.id},${input.businessId},'services',${input.fileId},${userId},
      ${input.createdAt},${input.expiresAt},${input.rowCount},${input.errors.length},
      ${JSON.stringify(input.rows)}::jsonb,${JSON.stringify(input.errors)}::jsonb)`);
}

function cleanImportError(error: unknown): never {
  if (error instanceof ServiceImportError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String(cause.code);
    if (['40001', '40P01', '55P03'].includes(code))
      throw new ServiceImportError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('SERVICE_IMPORT_PERSISTENCE_FAILED', { cause: error });
}

/**
 * يبني معاملات معاينة الخدمات على التفاف المستأجر، بحقائق الملف تُقرأ في معاملة أولى
 * والمطابقة والحفظ في معاملة ثانية واحدة، بينما قراءة التخزين خارجهما تماماً (072 D-4).
 *
 * @param database  بوابة المستأجر
 * @param fileFacts منفذ حقائق الملف المربوط عند التركيب في app.ts بلا سهم نحو files
 * @returns معاملات المعاينة
 */
export function createServiceImportTransactions(
  database: TenantWrappers,
  fileFacts: ServiceImportFileFactsPort | null,
): ServiceImportTransactions {
  return {
    runFacts: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              fileFacts: (fileId): Promise<ServiceImportFileFacts | null> =>
                fileFacts === null
                  ? Promise.resolve(null)
                  : fileFacts.facts(tx, companyId, fileId),
              categories: (businessId) => readOpenCategories(tx, companyId, businessId),
            }),
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
    runMatchAndSave: async ({ companyId, userId, businessId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          async (tx) =>
            work({
              matchCategories: (labels) => matchCategoryLabels(tx, companyId, businessId, labels),
              existingServiceKeys: (keys) => readExistingServiceKeys(tx, companyId, businessId, keys),
              save: (input) => savePreview(tx, companyId, userId, input),
            }),
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
  };
}
