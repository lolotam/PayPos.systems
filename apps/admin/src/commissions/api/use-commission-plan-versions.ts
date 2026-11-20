'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchCommissionPlanVersions } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  isPlanNotFound,
  planGeneration,
  planVersionsKey,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/**
 * تاريخ نسخ خطة موظفة واحدة صفحة بصفحة: معطّل مع قفل الوصول أو بعد 404 الموظفة (عشان ما يفضلش
 * يطلب موظفة اتشالت)، وبلا كاش بعد آخر مستمع، ورد بعد تغيّر الجيل بيتاهمل، و403 بيقفل النطاق كله.
 */
export function useCommissionPlanVersions(scope: PlanScope, employeeId: string) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  const [gone, setGone] = useState(false);
  return useInfiniteQuery({
    queryKey: planVersionsKey(scope, employeeId),
    queryFn: async ({ pageParam, signal }) => {
      const started = planGeneration(client, scope);
      try {
        const page = await fetchCommissionPlanVersions(scope, employeeId, pageParam, signal);
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return page;
      } catch (error) {
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        if (isPlanNotFound(error)) setGone(true);
        throw error;
      }
    },
    enabled: !gone && !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
