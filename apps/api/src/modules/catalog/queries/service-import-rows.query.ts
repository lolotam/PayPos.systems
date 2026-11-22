import type { ServiceImportRow, ServiceImportRowsPage } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

/** نتيجة صفحة SQL واحدة: هل المعاينة موجودة، عناصر الصفحة، آخر رقم فيها، وهل هناك صف بعدها. */
type PageResult = {
  found: boolean;
  items: ServiceImportRow[] | null;
  last_row_no: number | null;
  has_more: boolean;
};

/**
 * صفوف المعاينة النظيفة بترقيم الورقة الأصلي، لمنشئها داخل نشاطه وكيان خدماته فقط،
 * بصفحة واحدة على مؤشر رقم الصف (FR-011، عقد ServiceImportRowsPage). المؤشر والترتيب
 * والحدّ كلها داخل PostgreSQL على مصفوفة JSONB نفسها، فلا تُفكّك 500 صف وتُرتَّب في
 * JavaScript لصفحة من عشرين (قاعدة مسار القراءة).
 */
export async function serviceImportRowsPage(
  database: TenantWrappers,
  companyId: string,
  userId: string,
  businessId: string,
  previewId: string,
  cursor: string | undefined,
  limit: number,
): Promise<ServiceImportRowsPage> {
  const after = cursor === undefined ? 1 : Number(cursor);
  return database.withTenant(
    companyId,
    async (tx) => {
      const [page] = await tx.execute<PageResult>(sql`
        WITH preview AS (
          SELECT rows FROM import_previews
          WHERE company_id=${companyId} AND business_id=${businessId}
            AND created_by=${userId} AND id=${previewId} AND entity='services'
        ),
        page_rows AS (
          SELECT (r.value->>'row')::int AS row_no, r.value AS data
          FROM preview p, jsonb_array_elements(p.rows) AS r(value)
          WHERE (r.value->>'row')::int > ${after}
          ORDER BY 1
          LIMIT ${limit + 1}
        )
        SELECT
          (SELECT EXISTS (SELECT 1 FROM preview)) AS found,
          (SELECT COALESCE(jsonb_agg(data ORDER BY row_no), '[]'::jsonb) FROM (SELECT row_no, data FROM page_rows ORDER BY row_no LIMIT ${limit}) t) AS items,
          (SELECT max(row_no) FROM (SELECT row_no FROM page_rows ORDER BY row_no LIMIT ${limit}) t) AS last_row_no,
          EXISTS (SELECT 1 FROM page_rows OFFSET ${limit}) AS has_more`);
      if (page === undefined || !page.found) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      const items = page.items ?? [];
      const hasMore = page.has_more && page.last_row_no !== null;
      return { items, next_cursor: hasMore ? String(page.last_row_no) : null };
    },
    { userId },
  );
}
