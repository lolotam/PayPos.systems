'use client';
import { customerImportStatus, type CustomerImportStatus } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import type { CustomerImportTargetScope } from '../model/customer-import-status';

export const CUSTOMER_IMPORT_POLL_DEADLINE_MS = 2 * 60 * 1000;

const TERMINAL_STATUS = ['committed', 'failed'];

async function readStatus(
  { companyId, businessId, branchId }: CustomerImportTargetScope,
  previewId: string,
  signal: AbortSignal,
) {
  const header = { 'x-company-id': companyId };
  const result =
    branchId !== undefined
      ? await apiClient().GET('/v1/branches/{branchId}/customers/import/previews/{previewId}', {
          params: { header, path: { branchId, previewId } },
          signal,
        })
      : await apiClient().GET('/v1/businesses/{businessId}/customers/import/previews/{previewId}', {
          params: { header, path: { businessId, previewId } },
          signal,
        });
  if (result.error) throw { ...result.error, status: result.response.status };
  return customerImportStatus.parse(result.data);
}

/**
 * يتبع حالة الحفظ: القراءة تتكرر كل ثانية ما دامت الحالة commit_requested،
 * وتتوقف عند نتيجة نهائية أو بعد دقيقتين أو عند إغلاق الصفحة.
 */
export function useCustomerImportStatus(scope: CustomerImportTargetScope, previewId?: string) {
  const { companyId, businessId, branchId, userId } = scope;
  const key = `${companyId}:${businessId}:${branchId ?? 'business'}:${userId}:${previewId ?? ''}`;
  const [expiredKey, setExpiredKey] = useState<string>();
  const timedOut = expiredKey === key;
  useEffect(() => {
    if (previewId === undefined) return;
    const timer = setTimeout(() => setExpiredKey(key), CUSTOMER_IMPORT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [key, previewId]);
  const query = useQuery<CustomerImportStatus>({
    queryKey: [
      'customer-import-status',
      companyId,
      businessId,
      branchId ?? null,
      userId,
      previewId,
    ],
    enabled: previewId !== undefined,
    retry: false,
    refetchInterval: (current) => {
      if (timedOut) return false;
      const status = current.state.data?.status;
      return status === undefined || status === 'commit_requested' ? 1000 : false;
    },
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      if (previewId === undefined) throw new Error('IMPORT_PREVIEW_NOT_FOUND');
      return readStatus(scope, previewId, signal);
    },
  });
  return {
    ...query,
    timedOut: timedOut && !TERMINAL_STATUS.includes(query.data?.status ?? ''),
  };
}
