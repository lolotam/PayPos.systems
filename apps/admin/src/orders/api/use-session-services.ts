'use client';
import { sessionServiceOptionPage, sessionServiceOptionsQuery } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';

export type SessionServiceScope = { companyId: string; businessId: string; branchId: string; userId: string };

export function useSessionServices(scope: SessionServiceScope, search = '', enabled = true) {
  const lang = useLocale();
  const q = search.trim() || undefined;
  return useInfiniteQuery({
    queryKey: ['session-services', scope.companyId, scope.businessId, scope.branchId, scope.userId, lang, q],
    enabled, retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = sessionServiceOptionsQuery.parse({ lang, q, cursor: pageParam });
      const result = await apiClient().GET('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/service-options', {
        params: { header: { 'x-company-id': scope.companyId }, path: { businessId: scope.businessId, branchId: scope.branchId },
          query: { lang: query.lang, limit: query.limit,
            ...(query.q ? { q: query.q } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) } }, signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return sessionServiceOptionPage.parse(result.data);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
