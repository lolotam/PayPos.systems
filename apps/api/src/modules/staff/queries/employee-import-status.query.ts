import type { EmployeeImportStatus } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';

// المعاينة شخصية: عضوية SelectedCompanyGuard تكفي لقراءة حالة طلب المستخدم دون كشف طلب مدير آخر.
export async function employeeImportStatusQuery(
  database: TenantWrappers,
  companyId: string,
  userId: string,
  businessId: string,
  previewId: string,
): Promise<EmployeeImportStatus> {
  return database.withTenant(
    companyId,
    async (tx) => {
      const [row] =
        await tx.execute<EmployeeImportStatus>(sql`SELECT id AS preview_id,status,created_count,error_code
      FROM import_previews WHERE company_id=${companyId} AND business_id=${businessId}
        AND created_by=${userId} AND id=${previewId} AND entity='employees'`);
      if (row === undefined) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      return row;
    },
    { userId },
  );
}
