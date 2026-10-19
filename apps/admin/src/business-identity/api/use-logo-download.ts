'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { isAuthorizationRefusal } from '../model/identity-failure';
import { issueLogoDownload } from './identity-client';

export function logoDownloadKey(companyId: string, userId: string, fileId: string) {
  return ['business-identity', 'logo-download', companyId, userId, fileId] as const;
}

/**
 * الرابط الموقّع بيفضل في حالة المكوّن مش في بيانات الاستعلام، عشان الكاش المشترك ما يحتفظش بيه والمعاينة لسه ظاهرة.
 * gcTime 0 بيمسح حالة المحاولة لما المعاينة تتشال. إعادة المحاولة زر ظاهر؛ من غير إعادة تلقائية تخبّي أول فشل أو تعيد 403.
 */
export function useLogoDownload(companyId: string, userId: string, fileId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const query = useQuery({
    queryKey: logoDownloadKey(companyId, userId, fileId ?? 'none'),
    enabled: fileId !== null,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      if (fileId === null) throw new Error('logo file is missing');
      const download = await issueLogoDownload(companyId, fileId);
      setUrl(download.download_url);
      return { issued: true as const };
    },
  });
  const failure = query.isError ? query.error : null;
  return {
    url: query.isSuccess ? url : null,
    failure,
    pending: fileId !== null && query.isPending,
    refused: isAuthorizationRefusal(failure),
    retry: () => query.refetch(),
  };
}
