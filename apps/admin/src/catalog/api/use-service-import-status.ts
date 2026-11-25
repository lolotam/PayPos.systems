'use client';
import { serviceImportStatus, type ServiceImportStatus } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useEffect, useState } from 'react';

export const SERVICE_IMPORT_POLL_DEADLINE_MS = 2 * 60 * 1000;

const TERMINAL_STATUS = ['committed', 'failed'];

/**
 * يتبع حالة المعاينة بعد قبول الحفظ: القراءة تتكرر كل ثانية ما دامت الحالة
 * commit_requested، وتتوقف عند نتيجة نهائية أو بعد دقيقتين.
 */
export function useServiceImportStatus(
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
    const timer = setTimeout(() => setExpiredScope(scope), SERVICE_IMPORT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [scope, previewId]);
  const query = useQuery<ServiceImportStatus>({
    queryKey: ['service-import-status', companyId, businessId, userId, previewId],
    enabled: previewId !== undefined,
    retry: false,
    refetchInterval: (query) => {
      if (timedOut) return false;
      const status = query.state.data?.status;
      if (status === undefined || status === 'commit_requested') return 1000;
      return false;
    },
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (previewId === undefined) throw new Error('IMPORT_PREVIEW_NOT_FOUND');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/services/import/previews/{previewId}',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, previewId } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return serviceImportStatus.parse(result.data);
    },
  });
  return {
    ...query,
    timedOut: timedOut && !TERMINAL_STATUS.includes(query.data?.status ?? ''),
  };
}
