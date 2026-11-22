import type { ServiceImportRow, ServiceImportRowsPage } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

/** صف المعاينة المخزّن كما حفظته المعاينة: رقم الصف الأصلي وأعمدته المطبّعة كلها. */
type StoredRow = ServiceImportRow;

type StoredPreviewRows = { rows: readonly StoredRow[] };

// مؤشر الصفحات هو آخر صف في الصفحة الحالية نصاً عشرياً (دلالة keyset واحدة مع مؤشر المعاينة)،
// والصفوف المتناثرة تحفظ أرقامها، فلا صف يُعرض مرتين ولا صف يُفقد بين الصفحات (A-12/P-2).
function pageByOriginalRow(
  rows: readonly StoredRow[],
  cursor: string | undefined,
  limit: number,
): ServiceImportRowsPage {
  const after = cursor === undefined ? 1 : Number(cursor);
  const items = rows
    .filter((row) => row.row > after)
    .sort((left, right) => left.row - right.row)
    .slice(0, limit);
  const last = items.at(-1);
  const hasMore = last !== undefined && rows.some((row) => row.row > last.row);
  return { items: [...items], next_cursor: hasMore ? String(last?.row) : null };
}

/**
 * صفوف المعاينة النظيفة بترقيم الورقة الأصلي، لمنشئها داخل نشاطه وكيان خدماته فقط،
 * بصفحة واحدة على مؤشر رقم الصف (FR-011، عقد ServiceImportRowsPage).
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
  return database.withTenant(
    companyId,
    async (tx) => {
      const [row] = await tx.execute<StoredPreviewRows>(sql`
        SELECT rows FROM import_previews
        WHERE company_id=${companyId} AND business_id=${businessId}
          AND created_by=${userId} AND id=${previewId} AND entity='services'`);
      if (row === undefined) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      return pageByOriginalRow(row.rows, cursor, limit);
    },
    { userId },
  );
}
