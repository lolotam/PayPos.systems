'use client';
import { packageImportPreviewStatus, type PackageImportPreviewStatus } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';

export const PACKAGE_IMPORT_POLL_DEADLINE_MS = 2 * 60 * 1000;

const TERMINAL_STATUS = ['committed', 'failed'];

/** يستمر الاستعلام ما دامت المعاينة قيد التحضير أو الحفظ، ويتوقف عند الجاهزية دون طلب حفظ أو نتيجة نهائية. */
function shouldPoll(
  status: PackageImportPreviewStatus['status'] | undefined,
  commitAccepted: boolean,
) {
  if (status === undefined || status === 'pending' || status === 'commit_requested') return true;
  return commitAccepted && status === 'ready';
}

/**
 * يتبع حالة معاينة الباقات: المعاينة والحفظ كلاهما غير متزامن، فالقراءة تتكرر كل ثانية حتى
 * الجاهزية أو النتيجة النهائية. مهلة الدقيقتين تبدأ من جديد مع كل معاينة وكل طلب حفظ مقبول.
 */
export function usePackageImportStatus(
  { companyId, businessId, userId }: { companyId: string; businessId: string; userId: string },
  previewId: string | undefined,
  commitAccepted: boolean,
) {
  const scope = `${companyId}:${businessId}:${userId}:${previewId ?? ''}:${commitAccepted}`;
  const [expiredScope, setExpiredScope] = useState<string>();
  const timedOut = expiredScope === scope;
  useEffect(() => {
    if (previewId === undefined) return;
    const timer = setTimeout(() => setExpiredScope(scope), PACKAGE_IMPORT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [scope, previewId]);
  const query = useQuery<PackageImportPreviewStatus>({
    queryKey: ['package-import-status', companyId, businessId, userId, previewId],
    enabled: previewId !== undefined,
    retry: false,
    refetchInterval: (current) =>
      !timedOut && shouldPoll(current.state.data?.status, commitAccepted) ? 1000 : false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (previewId === undefined) throw new Error('IMPORT_PREVIEW_NOT_FOUND');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/packages/import/previews/{previewId}',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, previewId } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return packageImportPreviewStatus.parse(result.data);
    },
  });
  return {
    ...query,
    timedOut:
      timedOut &&
      !TERMINAL_STATUS.includes(query.data?.status ?? '') &&
      (query.data?.status !== 'ready' || commitAccepted),
  };
}
