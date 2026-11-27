'use client';

import type {
  CommissionPlanVersion,
  CommissionPlanVersionList,
  CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import type { InfiniteData } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type RefObject } from 'react';
import { createCommissionPlanVersion } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  isPlanNotFound,
  planGeneration,
  planVersionsKey,
  type PlanScope,
} from './plan-access';

/** محاولة حفظ لسه نتيجتها مجهولة: المفتاح بيفضل محفوظ لحد ما نجاح بيأكده. */
export type HeldPlanAttempt = { key: string; fingerprint: string };
/** ذاكرة المحاولات لكل موظفة في الهوية — بتعيش في الصفحة فما بتضيعش بانتقال الموظفات. */
export type PlanAttemptMemory = RefObject<Map<string, HeldPlanAttempt>>;

/** ذاكرة محاولات الحفظ اللي بتعيش مع الصفحة: بتنضف بس بتغير الهوية لأن المسار بيعمل remount. */
export function usePlanAttemptMemory(): PlanAttemptMemory {
  const [attempts] = useState(() => ({ current: new Map<string, HeldPlanAttempt>() }));
  return attempts;
}

/**
 * النسخة الجديدة هي الأحدث دايمًا، فالإضافة في أول صفحة التاريخ بتحفظ ترتيب الكيرسور
 * بدون ما نعمل refetch: إعادة جلب الصفحات بمفاتيحها القديمة بعد الإدراج بقدر يطلع صف رسم من النص.
 */
export function prependVersion(
  client: ReturnType<typeof useQueryClient>,
  scope: PlanScope,
  employeeId: string,
  version: CommissionPlanVersion,
): void {
  client.setQueriesData<InfiniteData<CommissionPlanVersionList>>(
    { queryKey: planVersionsKey(scope, employeeId) },
    (current) =>
      current === undefined
        ? current
        : {
            ...current,
            pages: current.pages.map((page, index) =>
              index === 0 ? { ...page, items: [version, ...page.items] } : page,
            ),
          },
  );
}

/**
 * بيحفظ نسخة خطة جديدة لموظفة: نفس الجسم لنفس الموظفة بيستعمل مفتاح المحاولة المحفوظ لحد ما نجاح
 * بيأكده (الرد المفقود ممكن يكون اتسجّل على السيرفر)، والجسم المختلف بياخد مفتاح جديد،
 * و403 بيقفل النطاق، و404 الموظفة بيشيل قيدها بس، ورد بعد تغيّر الجيل بيتاهمل بلا أي أثر.
 */
export function useSaveCommissionPlan(
  scope: PlanScope,
  employeeId: string,
  memory: PlanAttemptMemory,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['commission-plan-save', ...scope, employeeId],
    retry: false,
    gcTime: 0,
    mutationFn: async (body: CreateCommissionPlanVersionInput): Promise<CommissionPlanVersion> => {
      const started = planGeneration(client, scope);
      const fingerprint = JSON.stringify(body);
      const saved = memory.current.get(employeeId);
      const held =
        saved !== undefined && saved.fingerprint === fingerprint
          ? saved
          : { key: crypto.randomUUID(), fingerprint };
      memory.current.set(employeeId, held);
      try {
        const version = await createCommissionPlanVersion(scope, employeeId, held.key, body);
        if (planGeneration(client, scope) !== started) return version;
        memory.current.delete(employeeId);
        prependVersion(client, scope, employeeId, version);
        return version;
      } catch (error) {
        if (isPlanForbidden(error)) {
          memory.current.clear();
          await denyPlanAccess(client, scope);
        } else if (planGeneration(client, scope) === started && isPlanNotFound(error)) {
          memory.current.delete(employeeId);
        }
        throw error;
      }
    },
  });
}
