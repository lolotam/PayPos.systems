'use client';
import {
  packageSaleContext,
  packageSaleSellerOptionPage,
  sessionPerformerOptionsQuery,
  type PackageSaleSellerOptionPage,
} from '@pospay/contracts';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from './use-session-services';

const contextPath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales/context';
const sellersPath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales/seller-options';
type SellerPageRequest = { anchor: string; cursor: string };
type SellerPages = InfiniteData<PackageSaleSellerOptionPage, unknown>;

export function packageSaleScopeKey(scope: SessionServiceScope) {
  return [scope.companyId, scope.businessId, scope.branchId, scope.userId] as const;
}

export function packageSaleParams(scope: SessionServiceScope, idempotencyKey?: string) {
  return {
    header: {
      'x-company-id': scope.companyId,
      ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
    },
    path: { businessId: scope.businessId, branchId: scope.branchId },
  };
}

export function usePackageSaleContext(scope: SessionServiceScope, enabled = true) {
  return useQuery({
    queryKey: ['package-sale-context', ...packageSaleScopeKey(scope)],
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(contextPath, {
        params: packageSaleParams(scope),
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return packageSaleContext.parse(result.data);
    },
  });
}

type SellerPageQuery = {
  data: SellerPages | undefined;
  isPlaceholderData: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
};

function useSelectedSellerPage(query: SellerPageQuery, selectedSellerId: string) {
  const selectedIsPresent =
    !query.isPlaceholderData &&
    (query.data?.pages.some((page) => page.items.some((item) => item.id === selectedSellerId)) ??
      false);
  useEffect(() => {
    if (
      selectedSellerId &&
      !selectedIsPresent &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.isError
    ) {
      void query.fetchNextPage();
    }
  }, [
    query.fetchNextPage,
    query.hasNextPage,
    query.isError,
    query.isFetching,
    selectedIsPresent,
    selectedSellerId,
  ]);
}

export function usePackageSaleSellers(
  scope: SessionServiceScope,
  enabled = true,
  selectedSellerId = '',
) {
  const lang = useLocale();
  const context = usePackageSaleContext(scope, enabled);
  const anchor = context.data?.generated_at;
  const sellerScope = ['package-sale-sellers', ...packageSaleScopeKey(scope), lang] as const;
  const query = useInfiniteQuery({
    queryKey: [...sellerScope, anchor],
    enabled: enabled && anchor !== undefined,
    retry: false,
    placeholderData: (previousData: SellerPages | undefined, previousQuery) =>
      sellerScope.every((value, index) => previousQuery?.queryKey[index] === value)
        ? previousData
        : undefined,
    initialPageParam: undefined as SellerPageRequest | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const request = pageParam as SellerPageRequest | undefined;
      const input = sessionPerformerOptionsQuery.parse({
        lang,
        occurred_at: request?.anchor ?? anchor,
        cursor: request?.cursor,
      });
      const result = await apiClient().GET(sellersPath, {
        params: {
          ...packageSaleParams(scope),
          query: {
            lang: input.lang,
            occurred_at: input.occurred_at,
            limit: input.limit,
            ...(input.q ? { q: input.q } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
          },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return packageSaleSellerOptionPage.parse(result.data);
    },
    getNextPageParam: (last) =>
      last.next_cursor === null
        ? undefined
        : { anchor: last.sale_anchor, cursor: last.next_cursor },
  });
  useSelectedSellerPage(query, selectedSellerId);
  const retry = async () => {
    const refreshed = await context.refetch();
    if (refreshed.data?.generated_at === anchor) await query.refetch();
  };
  return { ...query, context, retry: () => void retry() };
}
