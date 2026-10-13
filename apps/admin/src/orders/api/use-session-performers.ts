'use client';
import { sessionPerformerOptionPage, sessionPerformerOptionsQuery } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';
import { useRecordingContext } from './use-recording-context';
import type { SessionServiceScope } from './use-session-services';

export function useSessionPerformers(scope: SessionServiceScope, occurredAt?: string, search = '', enabled = true, membershipId: string | null = null) {
  const lang = useLocale(), context = useRecordingContext(scope, membershipId, enabled);
  const instant = !occurredAt || occurredAt === 'now' ? context.data?.generated_at : occurredAt;
  const q = search.trim() || undefined, [settled, setSettled] = useState(q);
  const valid = sessionPerformerOptionsQuery.safeParse({ lang, q, occurred_at: instant }).success;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(q), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const ready = valid && q === settled;
  const query = useInfiniteQuery({
    queryKey: ['session-performers', scope.companyId, scope.businessId, scope.branchId, scope.userId, lang, settled, instant],
    enabled: enabled && ready, retry: false, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = sessionPerformerOptionsQuery.parse({ lang, q: settled, occurred_at: instant, cursor: pageParam });
      const result = await apiClient().GET('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/performer-options', {
        params: { header: { 'x-company-id': scope.companyId }, path: { businessId: scope.businessId, branchId: scope.branchId },
          query: { lang: params.lang, occurred_at: params.occurred_at, limit: params.limit,
            ...(params.q ? { q: params.q } : {}), ...(params.cursor ? { cursor: params.cursor } : {}) } }, signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return sessionPerformerOptionPage.parse(result.data);
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  return { ...query, data: enabled && ready ? query.data : undefined, instant, timeZone: context.data?.business_timezone,
    invalidSearch: !sessionPerformerOptionsQuery.omit({ occurred_at: true }).safeParse({ lang, q }).success,
    context };
}
