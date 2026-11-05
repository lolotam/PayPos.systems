import { packageImportPreviewStatus, type PackageImportPreviewStatus } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';

export interface PackagePreviewLookup {
  companyId: string;
  userId: string;
  businessId: string;
  previewId: string;
}

export function packagePreviewStatusStatement(actor: PackagePreviewLookup) {
  // شاشة استيراد الباقات بتتابع حالة المعاينة من غير عرض الصفوف أو بيانات الملف.
  return sql`SELECT CASE WHEN status='pending' AND expires_at<=CURRENT_TIMESTAMP THEN
    jsonb_build_object('preview_id',id,'status','failed','error_code','IMPORT_FILE_NOT_FOUND')
    ELSE jsonb_build_object('preview_id',id,'status',status) ||
    CASE status WHEN 'ready' THEN jsonb_build_object('row_count',row_count,'error_count',error_count,
      'skipped_count',skipped_count,'errors',errors)
    WHEN 'failed' THEN jsonb_build_object('error_code',error_code)
    ELSE '{}'::jsonb END END AS body
    FROM import_previews WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}
      AND created_by=${actor.userId} AND id=${actor.previewId} AND entity='packages'
      AND status IN ('pending','ready','failed')`;
}

export function packageImportPreviewStatusQuery(
  database: Pick<TenantWrappers, 'withTenant'>,
  actor: PackagePreviewLookup,
): Promise<PackageImportPreviewStatus> {
  return database.withTenant(
    actor.companyId,
    async (tx) => {
      const [row] = await tx.execute<{ body: unknown }>(packagePreviewStatusStatement(actor));
      if (row === undefined) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      return packageImportPreviewStatus.parse(row.body);
    },
    { userId: actor.userId },
  );
}
