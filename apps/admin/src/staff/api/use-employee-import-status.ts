'use client';
import { employeeImportStatus, type EmployeeImportStatus } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

// مفتاح المعاينة يحمل الشركة والنشاط والمستخدم؛ يتوقف polling عند أي نتيجة نهائية.
export function useEmployeeImportStatus(
  companyId: string,
  businessId: string,
  userId: string,
  previewId?: string,
) {
  return useQuery<EmployeeImportStatus>({
    queryKey: ['employee-import-status', companyId, businessId, userId, previewId],
    enabled: previewId !== undefined,
    retry: false,
    refetchInterval: (query) =>
      ['committed', 'failed'].includes(query.state.data?.status ?? '') ? false : 1000,
    queryFn: async ({ signal }) => {
      if (previewId === undefined) throw new Error('IMPORT_PREVIEW_NOT_FOUND');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/import/previews/{previewId}',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, previewId } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeImportStatus.parse(result.data);
    },
  });
}
