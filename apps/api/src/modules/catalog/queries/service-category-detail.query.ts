import {
  serviceCategoryDetail as serviceCategoryDetailSchema,
  type ServiceCategoryDetail,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export type ServiceCategoryDetailRow = {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly visibility: 'BUSINESS' | 'BRANCH';
  readonly owner_branch_id: string | null;
  readonly closed_at: string | null;
  readonly revision: number;
  readonly open_service_count: number;
  readonly marked_service_count: number;
};

// شاشة تأكيد قفل وفتح التصنيف تقرأ العددين اللذين سيتغيران مع بيانات التصنيف في استعلام واحد.
export function serviceCategoryDetailStatement(
  companyId: string,
  businessId: string,
  categoryId: string,
) {
  return sql`SELECT c.id,c.name_en,c.name_ar,c.visibility,c.owner_branch_id,
      to_char(c.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,
      c.revision,
      (SELECT count(*)::int FROM services s WHERE s.company_id=c.company_id
        AND s.business_id=c.business_id AND s.category_id=c.id AND s.closed_at IS NULL
      ) AS open_service_count,
      (SELECT count(*)::int FROM services s WHERE s.company_id=c.company_id
        AND s.business_id=c.business_id AND s.category_id=c.id AND s.closed_by_category_id=c.id
      ) AS marked_service_count
    FROM service_categories c
    WHERE c.company_id=${companyId} AND c.business_id=${businessId} AND c.id=${categoryId}`;
}

export async function serviceCategoryDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
): Promise<ServiceCategoryDetail | null> {
  const rows = await tx.execute<ServiceCategoryDetailRow>(
    serviceCategoryDetailStatement(companyId, businessId, categoryId),
  );
  const row = rows[0];
  return row === undefined ? null : serviceCategoryDetailSchema.parse(row);
}
