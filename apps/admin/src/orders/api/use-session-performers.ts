'use client';
import { sessionPerformerOptionPage, sessionPerformerOptionsQuery, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';
import { useRecordingContext } from './use-recording-context';
import type { SessionServiceScope } from './use-session-services';

async function performerPage(scope: SessionServiceScope, params: SessionPerformerOptionsQuery, signal: AbortSignal) {
  const result = await apiClient().GET('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/performer-options', {
    params: { header: { 'x-company-id': scope.companyId }, path: { businessId: scope.businessId, branchId: scope.branchId },
      query: { lang: params.lang, occurred_at: params.occurred_at, limit: params.limit,
        ...(params.q ? { q: params.q } : {}), ...(params.cursor ? { cursor: params.cursor } : {}) } }, signal,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return sessionPerformerOptionPage.parse(result.data);
}

export function useSessionPerformerFacts(scope: SessionServiceScope, instant: string | undefined, ids: string[], enabled: boolean) {
  const lang = useLocale();
  return useQuery({
    queryKey: ['session-performer-facts', scope.companyId, scope.businessId, scope.branchId, scope.userId, lang, instant, ids],
    enabled: enabled && ids.length > 0 && sessionPerformerOptionsQuery.safeParse({ lang, occurred_at: instant }).success, retry: false,
    queryFn: async ({ signal }) => {
      const missing = new Set(ids), found: ReturnType<typeof sessionPerformerOptionPage.parse>['items'] = [];
      let cursor: string | undefined;
      do {
        signal.throwIfAborted();
        const page = await performerPage(scope, sessionPerformerOptionsQuery.parse({ lang, occurred_at: instant, limit: 100, cursor }), signal);
        for (const item of page.items) if (missing.delete(item.id)) found.push(item);
        cursor = page.next_cursor ?? undefined;
      } while (missing.size && cursor);
      return found;
    },
  });
}

export function useSessionPerformers(scope: SessionServiceScope, occurredAt?: string, search = '', enabled = true) {
  const lang = useLocale(), context = useRecordingContext(scope, null, enabled, !occurredAt || occurredAt === 'now' ? 'now' : occurredAt);
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
      return performerPage(scope, params, signal);
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  return { ...query, data: enabled && ready ? query.data : undefined, instant, timeZone: context.data?.business_timezone,
    factsKey: JSON.stringify([scope.companyId, scope.businessId, scope.branchId, scope.userId, instant]),
    invalidSearch: !sessionPerformerOptionsQuery.omit({ occurred_at: true }).safeParse({ lang, q }).success,
    context };
}
