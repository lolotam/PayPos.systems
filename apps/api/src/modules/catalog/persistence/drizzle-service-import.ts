import { sql } from 'drizzle-orm';
import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';

import { normalizeServiceCategoryName } from '../domain/service-category.ts';
import {
  SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS,
  SERVICE_IMPORT_TEMPLATE_REFERENCE_FIXED_ROWS,
} from '../domain/service-import-template.ts';
import type { ServiceImportFileFacts } from '../domain/service-import-file.ts';
import type {
  SaveServiceImportPreviewInput,
  ServiceImportCategoryMatch,
  ServiceImportFileFactsPort,
  ServiceImportTransactions,
} from '../ports/service-import.port.ts';
import {
  cleanImportError,
  createServiceImportCommitTransactions,
} from './drizzle-service-import-commit.ts';

/** تصنيفات النشاط المفتوحة للاستعلام المشترك؛ الحد أعلى من سقف القالب بصف واحد ليكشف التجاوز
 * دون مادةلة قائمة كاملة لنشاط فوق السقف (P2 مراجعة 1186). */
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
    ORDER BY name_en
    LIMIT ${SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS - SERVICE_IMPORT_TEMPLATE_REFERENCE_FIXED_ROWS + 1}`);
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
  return resolveCategoryMatches(labels, rows);
}

/** يعيد ربط حلول قاعدة البيانات بالتسميات المطلوبة بترتيبها الأصلي؛ الفهرس الفريد يضمن حلّاً واحداً لكل نص. */
function resolveCategoryMatches(
  labels: readonly string[],
  rows: readonly { label: string; id: string; name_en: string }[],
): readonly ServiceImportCategoryMatch[] {
  const byLabel = new Map(rows.map((row) => [normalizeServiceCategoryName(row.label), row]));
  return labels.flatMap((label) => {
    const row = byLabel.get(normalizeServiceCategoryName(label));
    return row === undefined
      ? []
      : [{ label, id: row.id, nameEn: row.name_en }];
  });
}

/** القراءة الحاسمة للأسماء داخل النشاط، المفتوحة والمقفولة معاً — الطرفان يُطويان بتعبير PostgreSQL
 * واحد (طيّ المسافات والتشذيب والحروف الصغيرة)، والتكرار داخل الملف حساب نافذة على المدخل نفسه،
 * والوجود انضمام نصف واحد على المفاتيح المُفرَّدة فمسح واحد لخدمات النشاط مهما كان عدد الصفوف
 * (FR-007، HIGH مراجعة 1186)؛ فرق Unicode المتبقى موثّق في متجهات A-11. */
async function matchServiceNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  labels: readonly string[],
): Promise<readonly { duplicate_in_file: boolean; exists: boolean }[]> {
  if (labels.length === 0) return [];
  const rows = await tx.execute<{ duplicate_in_file: boolean; exists_stored: boolean }>(sql`
    WITH input AS (
      SELECT ord, lower(btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g'))) AS lookup_key
      FROM unnest(ARRAY[${sql.join(labels.map((label) => sql`${label}`), sql`, `)}]::text[])
        WITH ORDINALITY AS t(label, ord)
    ),
    folded AS (
      SELECT ord, lookup_key,
        count(*) OVER (PARTITION BY lookup_key) > 1 AS duplicate_in_file
      FROM input
    ),
    stored AS (
      SELECT DISTINCT lower(btrim(regexp_replace(s.name_en, '[[:space:]]+', ' ', 'g'))) AS lookup_key
      FROM services s
      JOIN (SELECT DISTINCT lookup_key FROM input) k
        ON lower(btrim(regexp_replace(s.name_en, '[[:space:]]+', ' ', 'g'))) = k.lookup_key
      WHERE s.company_id = ${companyId}
       AND s.business_id = ${businessId}
    )
    SELECT f.duplicate_in_file, (s.lookup_key IS NOT NULL) AS exists_stored
    FROM folded f
    LEFT JOIN stored s ON s.lookup_key = f.lookup_key
    ORDER BY f.ord`);
  return rows.map((row) => ({
    duplicate_in_file: row.duplicate_in_file,
    exists: row.exists_stored,
  }));
}

/** بنية نطاق المطابقة والحفظ على معاملة واحدة: المطابقات والأسماء والقراءة والحفظ. */
interface MatchAndSaveScopeArgs {
  readonly tx: Tx;
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
}

/** يبني نطاق المطابقة والحفظ، فاصلٌ ليبقى سهام المعاملات تحت حد الأسطر (CLAUDE.md §3). */
function matchAndSaveScope(args: MatchAndSaveScopeArgs) {
  const { tx, companyId, businessId, userId } = args;
  return {
    matchCategories: (labels: readonly string[]) =>
      matchCategoryLabels(tx, companyId, businessId, labels),
    matchServiceNames: (labels: readonly string[]) =>
      matchServiceNames(tx, companyId, businessId, labels),
    save: (input: SaveServiceImportPreviewInput) => savePreview(tx, companyId, userId, input),
  };
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

/** يسجّل دخولًا تدقيقيًا على الوصول للملف الخاص في مسار المعاينة (CLAUDE.md §8). */
async function auditFileAccess(tx: Tx, fileId: string, id: string): Promise<void> {
  await appendAuditLog(tx, id, {
    entity: 'file',
    entityId: fileId,
    action: 'access',
    after: { purpose: 'services_import_preview' },
  });
}

/**
 * يبني معاملات معاينة الخدمات على التفاف المستأجر، بحقائق الملف تُقرأ في معاملة أولى
 * والمطابقة والحفظ في معاملة ثانية واحدة، بينما قراءة التخزين خارجهما تماماً (072 D-4).
 *
 * @param database  بوابة المستأجر
 * @param fileFacts منفذ حقائق الملف المربوط عند التركيب في app.ts بلا سهم نحو files
 * @param ids       مولّد معرّفات سطر التدقيق المحقون
 * @returns معاملات المعاينة
 */
export function createServiceImportTransactions(
  database: TenantWrappers,
  fileFacts: ServiceImportFileFactsPort | null,
  ids: IdGenerator,
): ServiceImportTransactions {
  const commit = createServiceImportCommitTransactions(database, ids);
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
              auditFileAccess: (fileId) => auditFileAccess(tx, fileId, ids.newId()),
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
          async (tx) => work(matchAndSaveScope({ tx, companyId, businessId, userId })),
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
    runCommit: commit.runCommit,
  };
}
