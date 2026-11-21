import { useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useCustomerPackages } from '../api/use-customer-packages';
import type { SessionServiceScope } from '../api/use-session-services';
import { packageListState } from '../model/use-package-route-selection';

export function usePackagePageList(scope: SessionServiceScope, customerId: string | null) {
  const list = useCustomerPackages(scope, customerId ?? '', customerId !== null, true);
  const proof = readAccessProof(list);
  const { state, errorMessage } = packageListState({
    isError: list.isError,
    isPending: list.isPending,
    error: list.error,
    itemCount: list.data?.items.length ?? 0,
  });
  const scopeKey = [
    scope.companyId,
    scope.businessId,
    scope.branchId,
    scope.userId,
    customerId,
  ].join(':');
  const [grantedKey, setGrantedKey] = useState<string | null>(null);
  const accessGranted = grantedKey === scopeKey;
  const nextPageFailed = list.isFetchNextPageError && errorMessage === 'loadFailed';
  const canShowPackages = proof === 'granted' || (accessGranted && nextPageFailed);
  const verifiedKey = canShowPackages ? scopeKey : null;
  if (grantedKey !== verifiedKey) setGrantedKey(verifiedKey);
  const loadMore = () => {
    if (!list.isFetching) void list.fetchNextPage({ cancelRefetch: false });
  };
  return {
    proof,
    canShowPackages,
    listProps: {
      items: canShowPackages ? (list.data?.items ?? []) : [],
      state,
      errorMessage,
      hasMore: list.hasNextPage,
      isFetching: list.isFetching,
      onRetry:
        accessGranted && nextPageFailed
          ? loadMore
          : () => void list.refetch({ cancelRefetch: false }),
      onMore: loadMore,
    },
  };
}
