import type { ServiceImportStatus } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

// حالة المعاينة شخصية لمنشئها: عضوية SelectedCompanyGuard لا تكشف حالة مدير آخر، وكيان الاستيراد
// مربوط بالخدمات فمعاينة الموظفين أو الباقات مجهولة على المسار نفسه (FR-011).
export async function serviceImportStatusQuery(
  database: TenantWrappers,
  companyId: string,
  userId: string,
  businessId: string,
  previewId: string,
): Promise<ServiceImportStatus> {
  return database.withTenant(
    companyId,
    async (tx) => {
      const [row] =
        await tx.execute<ServiceImportStatus>(sql`SELECT id AS preview_id,status,created_count,error_code
      FROM import_previews WHERE company_id=${companyId} AND business_id=${businessId}
        AND created_by=${userId} AND id=${previewId} AND entity='services'`);
      if (row === undefined) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      return row;
    },
    { userId },
  );
}
