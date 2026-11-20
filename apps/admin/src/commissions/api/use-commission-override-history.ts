'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOverrideHistory } from './commission-overrides-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  planGeneration,
  planOverrideHistoryKey,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/** تاريخ تجاوزات خدمة واحدة: بيتقرأ طول ما الحوار مفتوح على الخدمة دي بس، ونفس قواعد الوصول. */
export function useCommissionOverrideHistory(
  scope: PlanScope,
  employeeId: string,
  serviceId: string | null,
) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  return useInfiniteQuery({
    // معرّف الخدمة UUID، فسلسلة الحارس دي مستحيل تصطدم بمعرّف حقيقي.
    queryKey: planOverrideHistoryKey(scope, employeeId, serviceId ?? 'closed'),
    queryFn: async ({ pageParam: cursor, signal }) => {
      if (serviceId === null) throw new Error('commission-override-service-missing');
      const started = planGeneration(client, scope);
      try {
        const page = await fetchOverrideHistory(scope, employeeId, serviceId, { cursor, signal });
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return page;
      } catch (error) {
        if (signal.aborted || planGeneration(client, scope) !== started) throw error;
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        throw error;
      }
    },
    enabled: serviceId !== null && !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
