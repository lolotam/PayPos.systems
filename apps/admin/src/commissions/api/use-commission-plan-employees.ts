'use client';

import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CommissionPlanEmployeeList } from '@pospay/contracts';
import { fetchCommissionPlanEmployees } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  planEmployeesKey,
  planGeneration,
  planProbeKey,
  planScope,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/**
 * قائمة موظفي الخطط صفحة بصفحة لكل هوية: معطّلة طول ما الوصول مقفول، بلا إعادة محاولة وبلا كاش
 * بعد آخر مستمع عشان الرجوع لهوية يبدأ من صفر، وأي رد وصل بعد تغيّر الجيل بيتاهمل،
 * و403 في أي صفحة بيقفل النطاق كله من غير حلقة طلبات.
 * الفحص اللي بتعمله القوائم بيبعت سطر واحد بس (limit=1) ويشبع من أول صفحة ناجحة في الشاشة،
 * فمش بيعيد الجلب مع كل refocus وبيفضل بالجيل الجديد بعد أي قفل وصول.
 *
 * @param scope هوية الشركة والنشاط والمستخدم، أو null قبل ما الهوية تتقرأ
 * @param options `probe` للفحص بسطر واحد، وهو مش قراءة شاشة كاملة
 * @returns حالة القراءة وصفحات موظفي الخطط
 */
export function useCommissionPlanEmployees(
  scope: PlanScope | null,
  options?: { readonly probe?: boolean },
) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  const probe = options?.probe === true;
  const resolvedScope = scope ?? planScope('', '', '');
  return useInfiniteQuery({
    queryKey: probe ? planProbeKey(resolvedScope) : planEmployeesKey(resolvedScope),
    queryFn: async ({ pageParam, signal }) => {
      if (scope === null) throw new Error('commission-plan-scope-missing');
      const started = planGeneration(client, scope);
      try {
        const page = await fetchCommissionPlanEmployees(scope, pageParam, signal, probe ? 1 : 50);
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        // أول صفحة ناجحة في الشاشة بتشبع فحص القوائم، فالقائمة ما تطلبش تاني.
        if (!probe && pageParam === undefined) {
          client.setQueryData<InfiniteData<CommissionPlanEmployeeList, string | undefined>>(
            planProbeKey(scope),
            (current) => current ?? { pages: [page], pageParams: [undefined] },
          );
        }
        return page;
      } catch (error) {
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        throw error;
      }
    },
    enabled: scope !== null && !access.denied,
    retry: false,
    staleTime: probe ? Number.POSITIVE_INFINITY : 0,
    gcTime: 0,
    refetchOnWindowFocus: !probe,
    refetchOnReconnect: !probe,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
