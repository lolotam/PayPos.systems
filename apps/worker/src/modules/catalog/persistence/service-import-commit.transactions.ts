import { sql } from 'drizzle-orm';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';

import type { ServiceImportNormalizedRow } from '../domain/service-import-commit.ts';
import type {
  ServiceImportCommitScope,
  ServiceImportCommitTransactions,
} from '../ports/service-import-commit.port.ts';
import { insertImportedServices } from './service-import-commit.writes.ts';

type CommitRow = ServiceImportNormalizedRow;

/** التقرير الحي للنشاط على معاملة الالتزام نفسها: غياب النشاط بعد القبول فشل تثبيت مُسمّى (FR-009). */
async function businessExists(tx: Tx, companyId: string, businessId: string): Promise<boolean> {
  const rows = await tx.execute<{ present: number }>(
    sql`SELECT 1 AS present FROM businesses WHERE company_id = ${companyId} AND id = ${businessId} LIMIT 1`,
  );
  return rows.length > 0;
}

/** القراءة الحاسمة للأسماء داخل النشاط، المفتوحة والمقفولة معاً — الطرفان يُطويان بتعبير PostgreSQL
 * واحد (طيّ المسافات والتشذيب والحروف الصغيرة) مطابق لما تشغّله المعاينة، فلا يبقى اختلاف بين
 * مطوي JavaScript والمخزن (HIGH مراجعة 1186)؛ فرق Unicode المتبقى موثّق في متجهات A-11. */
async function readExistingNameKeys(
  tx: Tx,
  companyId: string,
  businessId: string,
  names: readonly string[],
): Promise<readonly string[]> {
  if (names.length === 0) return [];
  const rows = await tx.execute<{ lookup_key: string }>(sql`
    WITH input AS (
      SELECT name, lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) AS lookup_key
      FROM unnest(ARRAY[${sql.join(names.map((name) => sql`${name}`), sql`, `)}]::text[]) AS t(name)
    )
    SELECT DISTINCT i.lookup_key
    FROM input i
    JOIN services s
      ON s.company_id = ${companyId}
     AND s.business_id = ${businessId}
     AND lower(btrim(regexp_replace(s.name_en, '[[:space:]]+', ' ', 'g'))) = i.lookup_key`);
  return rows.map((row) => row.lookup_key);
}

/** قفل التصنيفات المُحالة بترتيب صاعد FOR SHARE ثم إعادة حالتها للتحقق قبل الإدخال (FR-009). */
async function lockImportCategories(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly closed_at: string | null }>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; closed_at: Date | string | null }>(sql`
    SELECT id, closed_at
    FROM service_categories
    WHERE company_id = ${companyId}
      AND business_id = ${businessId}
      AND id = ANY(ARRAY[${sql.join(categoryIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])
    ORDER BY id
    FOR SHARE`);
  return new Map(
    rows.map((row) => [
      row.id,
      { closed_at: row.closed_at === null ? null : new Date(row.closed_at).toISOString() },
    ]),
  );
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * نطاق الالتزام المعقول على المعاملة والشركة: القفل الاستشاري على ثلاثية الشركة والنشاط
 * والغرض، والقراءة الحاسمة، وقفل التصنيفات صاعداً، والكتابة والإتمام في نفس المعاملة (FR-009).
 */
function commitScope(tx: Tx, companyId: string, ids: IdGenerator): ServiceImportCommitScope {
  return {
    lockImport: async (businessId) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${businessId}:service-import`}, 0))`,
      );
    },
    businessExists: (businessId) => businessExists(tx, companyId, businessId),
    existingNameKeys: (businessId, keys) =>
      readExistingNameKeys(tx, companyId, businessId, keys),
    lockCategories: (businessId, categoryIds) =>
      lockImportCategories(tx, companyId, businessId, categoryIds),
    insert: async (records) => insertImportedServices(tx, companyId, ids, records),
    complete: async (preview, count, at) => {
      await tx.execute(
        // بند الكيان إلزامي في كل تحديث معاينة كتالوج: الجدول المشترك لا يفرز عزل الكيانات (072 D-1).
        sql`UPDATE import_previews SET status='committed',committed_at=${at},created_count=${count}
          WHERE company_id=app_company_id() AND id=${preview.id} AND entity='services'`,
      );
    },
  };
}

/**
 * يبني معاملات تثبيت استيراد الخدمات: معاملة واحدة تقفل المعاينة FOR UPDATE وتشترط الطلب الحي،
 * والفشل الشرطي يُكتب بعد التراجع في معاملة مستأجر مستقلة على الطلبات الحية فقط (FR-009).
 *
 * @param database بوابة المستأجر
 * @param ids      مولّد معرّفات الخدمات والتدقيق المحقون
 * @returns معاملات الالتزام
 */
export function serviceImportCommitTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): ServiceImportCommitTransactions {
  return {
    run: (companyId, previewId, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const scope = commitScope(tx, companyId, ids);
          const [row] = await tx.execute<{
            id: string;
            business_id: string;
            created_by: string;
            status: string;
            requested_at: Date | string;
            expires_at: Date | string;
            error_count: number;
            rows: readonly CommitRow[];
          }>(sql`SELECT id,business_id,created_by,status,requested_at,expires_at,error_count,rows
            FROM import_previews
            WHERE company_id=${companyId} AND id=${previewId} AND entity='services' FOR UPDATE`);
          // الكيان غير الخدمات أو الحالة غير «مطلوب» يُسلَّم نطاقاً بلا معاينة فالعمل يتجاهله سكوتاً:
          // إعادة التسليم بعد النجاح ووظيفة كيان آخر وتكرار الوصول كلها تجاهل بلا كتابة.
          if (row === undefined || row.status !== 'commit_requested') {
            await work({ preview: null, ...scope });
            return;
          }
          // التدقيق يحمل صاحب الطلب المقبول من الصف المقفل لا من حمولة الوظيفة (ADR-0034).
          await tx.execute(sql`SELECT set_config('app.user_id',${row.created_by},true)`);
          await work({
            preview: {
              id: row.id,
              business_id: row.business_id,
              created_by: row.created_by,
              requested_at: asIso(row.requested_at),
              expires_at: asIso(row.expires_at),
              error_count: row.error_count,
              rows: row.rows,
            },
            ...scope,
          });
        },
        { timeoutMs: 15000 },
      ),
    fail: (companyId, previewId, code) =>
      database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET status='failed',error_code=${code}
          WHERE company_id=${companyId} AND id=${previewId} AND entity='services'
            AND status='commit_requested'`);
      }),
  };
}
