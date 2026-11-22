'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLatestOrdinaryCommissionPlanVersion } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  planGeneration,
  planSeedKey,
  usePlanAccess,
  type PlanScope,
} from './plan-access';

/**
 * أحدث نسخة عادية للموظفة (من غير نسخ الإصلاح) كأساس للمحرّر، من قراءة السيرفر نفسه قبل الـ LIMIT:
 * أول صفحة تاريخ ممكن تبقى كلها إصلاحات فما تنفعش أساس. القيمة null معناها إن القراءة نجحت وأكدت إن
 * مفيش نسخة عادية، والفشل بيفضل خطأ في الاستعلام فالمحرّر ما بيفتحش بمسودة فاضية لخطة موجودة.
 */
export function useCommissionPlanSeed(scope: PlanScope, employeeId: string) {
  const client = useQueryClient();
  const access = usePlanAccess(scope);
  return useQuery({
    queryKey: planSeedKey(scope, employeeId),
    queryFn: async ({ signal }) => {
      const started = planGeneration(client, scope);
      try {
        const version = await fetchLatestOrdinaryCommissionPlanVersion(scope, employeeId, signal);
        if (planGeneration(client, scope) !== started)
          throw new Error('commission-plan-generation-changed');
        return version;
      } catch (error) {
        if (isPlanForbidden(error)) await denyPlanAccess(client, scope);
        throw error;
      }
    },
    enabled: !access.denied,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
