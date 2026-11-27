'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { CommissionBlockedCorrectionStatus } from '@pospay/contracts';
import { fetchCommissionBlockedCorrections } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  planBlockedCorrectionsKey,
  planGeneration,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/**
 * قائمة التصحيحات الموقوفة صفحة بصفحة بالفلتر المختار: معطّلة طول ما الوصول مقفول، بلا إعادة محاولة وبلا كاش
 * بعد آخر مستمع، ورد وصل بعد تغيّر الجيل بيتاهمل، و403 بيقفل النطاق كله من غير حلقة طلبات.
 *
 * @param scope هوية الشركة والنشاط والمستخدم
 * @param status فلتر الحالة
 * @returns حالة القراءة وصفحات التصحيحات الموقوفة
 */
export function useCommissionBlockedCorrections(
  scope: PlanScope,
  status: CommissionBlockedCorrectionStatus,
) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  return useInfiniteQuery({
    queryKey: planBlockedCorrectionsKey(scope, status),
    queryFn: async ({ pageParam, signal }) => {
      const started = planGeneration(client, scope);
      try {
        const page = await fetchCommissionBlockedCorrections(scope, status, pageParam, signal);
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return page;
      } catch (error) {
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        throw error;
      }
    },
    enabled: !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
