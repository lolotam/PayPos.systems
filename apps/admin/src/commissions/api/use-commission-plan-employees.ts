'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCommissionPlanEmployees } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  planEmployeesKey,
  planGeneration,
  planScope,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/**
 * قائمة موظفي الخطط صفحة بصفحة لكل هوية: معطّلة طول ما الوصول مقفول، بلا إعادة محاولة وبلا كاش
 * بعد آخر مستمع عشان الرجوع لهوية يبدأ من صفر، وأي رد وصل بعد تغيّر الجيل بيتاهمل،
 * و403 في أي صفحة بيقفل النطاق كله من غير حلقة طلبات.
 */
export function useCommissionPlanEmployees(scope: PlanScope | null) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  return useInfiniteQuery({
    queryKey: planEmployeesKey(scope ?? planScope('', '', '')),
    queryFn: async ({ pageParam, signal }) => {
      if (scope === null) throw new Error('commission-plan-scope-missing');
      const started = planGeneration(client, scope);
      try {
        const page = await fetchCommissionPlanEmployees(scope, pageParam, signal);
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return page;
      } catch (error) {
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        throw error;
      }
    },
    enabled: scope !== null && !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
