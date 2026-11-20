'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchOverrideServices } from './commission-overrides-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  isPlanNotFound,
  planGeneration,
  planOverrideServicesKey,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/** جدول خدمات الشاشة صفحة بصفحة: معطّل طول ما الوصول مقفول أو الموظفة اتشالت، و403 بيقفل النطاق. */
export function useCommissionOverrideServices(scope: PlanScope, employeeId: string) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  const queryKey = planOverrideServicesKey(scope, employeeId);
  const identity = JSON.stringify(queryKey);
  const [gone, setGone] = useState<string>();
  return useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam: cursor, signal }) => {
      const started = planGeneration(client, scope);
      try {
        const page = await fetchOverrideServices(scope, employeeId, { cursor, signal });
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return page;
      } catch (error) {
        if (signal.aborted || planGeneration(client, scope) !== started) throw error;
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        if (isPlanNotFound(error)) setGone(identity);
        throw error;
      }
    },
    enabled: gone !== identity && !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
