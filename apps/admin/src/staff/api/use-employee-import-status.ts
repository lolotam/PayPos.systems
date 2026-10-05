'use client';
import { employeeImportStatus, type EmployeeImportStatus } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useEffect, useState } from 'react';

export const IMPORT_POLL_DEADLINE_MS = 2 * 60 * 1000;

// مفتاح المعاينة يعزل الشركة والنشاط والمستخدم؛ يتوقف polling عند النتيجة النهائية أو بعد دقيقتين.
export function useEmployeeImportStatus(
  companyId: string,
  businessId: string,
  userId: string,
  previewId?: string,
) {
  const scope = `${companyId}:${businessId}:${userId}:${previewId ?? ''}`;
  const [expiredScope, setExpiredScope] = useState<string>();
  const timedOut = expiredScope === scope;
  useEffect(() => {
    if (previewId === undefined) return;
    const timer = setTimeout(() => setExpiredScope(scope), IMPORT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [scope, previewId]);
  const query = useQuery<EmployeeImportStatus>({
    queryKey: ['employee-import-status', companyId, businessId, userId, previewId],
    enabled: previewId !== undefined,
    retry: false,
    refetchInterval: (query) =>
      timedOut || ['committed', 'failed'].includes(query.state.data?.status ?? '') ? false : 1000,
    refetchOnWindowFocus: false,
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
  return {
    ...query,
    timedOut: timedOut && !['committed', 'failed'].includes(query.data?.status ?? ''),
  };
}
