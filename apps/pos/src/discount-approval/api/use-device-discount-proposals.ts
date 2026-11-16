import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { DeviceDiscountReadError, readDeviceDiscountProposals } from './device-discount-calls';

export function useDeviceDiscountProposals(branchId: string, onRejected: () => Promise<void>) {
  const query = useInfiniteQuery({
    queryKey: ['device-discount-proposals', branchId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => readDeviceDiscountProposals(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 30_000,
    gcTime: 0,
    retry: false,
  });
  const { error, refetch } = query;
  useEffect(() => {
    if (error instanceof DeviceDiscountReadError && error.rejected) void onRejected();
  }, [error, onRejected]);
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    isPending: query.isPending,
    isError: query.isError,
    retry: () => void refetch(),
  };
}
