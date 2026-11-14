import {
  serviceCategoryClosingStatus as serviceCategoryClosingStatusSchema,
  type ServiceCategoryClosingStatus,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export type ServiceCategoryClosingRow = {
  readonly id: string;
  readonly business_id: string;
  readonly category_id: string;
  readonly action: 'close' | 'reopen';
  readonly status: 'pending' | 'completed' | 'failed';
  readonly services_changed: number | null;
  readonly error_code: string | null;
  readonly requested_at: string;
  readonly finished_at: string | null;
};

// شاشة متابعة قفل التصنيف تقرأ حالة الطلب الواحد بمفتاحه الأساسي (الشركة والمعرّف)،
// والنشاط والتصنيف مرشّحان على الصف نفسه حتى يطابق Postgres معرّفات uuid بغضّ النظر عن حالة الحروف.
export function serviceCategoryClosingStatusStatement(
  companyId: string,
  businessId: string,
  categoryId: string,
  closingId: string,
) {
  return sql`SELECT id,business_id,category_id,action,
      CASE WHEN status='pending' AND deadline_at <= now() THEN 'failed' ELSE status END AS status,
      CASE WHEN status='pending' AND deadline_at <= now() THEN 'SERVICE_CATEGORY_CLOSING_EXPIRED'
        ELSE error_code END AS error_code,
      services_changed,
      to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,
      to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at
    FROM service_category_closings
    WHERE company_id=${companyId} AND id=${closingId}
      AND business_id=${businessId} AND category_id=${categoryId}`;
}

export async function serviceCategoryClosingStatus(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
  closingId: string,
): Promise<ServiceCategoryClosingStatus | null> {
  const rows = await tx.execute<ServiceCategoryClosingRow>(
    serviceCategoryClosingStatusStatement(companyId, businessId, categoryId, closingId),
  );
  const row = rows[0];
  if (row === undefined) return null;
  return serviceCategoryClosingStatusSchema.parse({
    closing_id: row.id,
    category_id: row.category_id,
    action: row.action,
    status: row.status,
    services_changed: row.services_changed,
    error_code: row.error_code,
    requested_at: row.requested_at,
    finished_at: row.finished_at,
  });
}
