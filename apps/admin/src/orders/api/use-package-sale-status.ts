'use client';
import { packageSaleStatus, type PackageSaleStatus } from '@pospay/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import type { SessionServiceScope } from './use-session-services';

export const PACKAGE_SALE_POLL_LIMIT_MS = 60_000;
const statusPath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales/{saleRequestId}';

type StatusDeadline = { request: string; at: number; done: boolean };

export function usePackageSaleStatus(scope: SessionServiceScope, saleRequestId: string | null) {
  const client = useQueryClient();
  const queryKey = useMemo(
    () => ['package-sale-status', ...packageSaleScopeKey(scope), saleRequestId],
    [scope.companyId, scope.businessId, scope.branchId, scope.userId, saleRequestId],
  );
  const requestKey = JSON.stringify(queryKey);
  const [deadline, setDeadline] = useState<StatusDeadline | null>(null);
  const query = useQuery<PackageSaleStatus>({
    queryKey,
    enabled: saleRequestId !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (current) => {
      if (current.state.data?.status !== 'pending') return false;
      if (deadline?.request !== requestKey || deadline.done) return false;
      return Date.now() - deadline.at < PACKAGE_SALE_POLL_LIMIT_MS ? 1000 : false;
    },
    queryFn: async ({ signal }) => {
      if (saleRequestId === null) throw new Error('PACKAGE_SALE_NOT_REQUESTED');
      const result = await apiClient().GET(statusPath, {
        params: {
          ...packageSaleParams(scope),
          path: { businessId: scope.businessId, branchId: scope.branchId, saleRequestId },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return packageSaleStatus.parse(result.data);
    },
  });
  useEffect(() => {
    if (saleRequestId === null) {
      setDeadline(null);
      return;
    }
    setDeadline({ request: requestKey, at: Date.now(), done: false });
    const timer = setTimeout(() => {
      setDeadline((current) =>
        current?.request === requestKey ? { ...current, done: true } : current,
      );
    }, PACKAGE_SALE_POLL_LIMIT_MS);
    return () => {
      clearTimeout(timer);
      void client.cancelQueries({ queryKey, exact: true });
    };
  }, [client, queryKey, requestKey, saleRequestId]);
  const timedOut =
    saleRequestId !== null &&
    deadline?.request === requestKey &&
    deadline.done &&
    query.data?.status !== 'completed' &&
    query.data?.status !== 'failed';
  const recheck = async () => {
    await client.cancelQueries({ queryKey, exact: true });
    await query.refetch();
  };
  return { ...query, timedOut, recheck: () => void recheck() };
}
