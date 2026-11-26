'use client';

import type {
  CommissionPeriodRepair,
  CreateCommissionPeriodRepairInput,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCommissionPeriodRepair } from './commission-plans-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  isPlanNotFound,
  planBlockedCorrectionsKey,
  planGeneration,
  type PlanScope,
} from './plan-access';
import { prependVersion, type PlanAttemptMemory } from './use-save-commission-plan';

/** طلب إصلاح شهر: الموظفة وجسم الطلب (الشهر المحجوز وخطة الإصلاح). */
export interface RepairCommissionPeriodVariables {
  readonly employeeId: string;
  readonly body: CreateCommissionPeriodRepairInput;
}

/**
 * بيعمل إصلاح شهر مقفول لموظفة: نفس الجسم لنفس الموظفة والشهر بيستعمل مفتاح المحاولة المحفوظ لحد ما نجاح
 * بيأكده (الرد المفقود ممكن يكون اتسجّل على السيرفر)، والجسم المختلف بياخد مفتاح جديد. النجاح بيضيف النسخة لأول
 * صفحة تاريخ الموظفة لو محمّلة وبيبطّل قوائم التصحيحات الموقوفة، و403 بيقفل النطاق، و404 الموظفة بيشيل قيدها بس،
 * ورد بعد تغيّر الجيل بيتاهمل بلا أي أثر.
 *
 * @param scope هوية الشركة والنشاط والمستخدم
 * @param memory ذاكرة المحاولات اللي بتعيش مع الصفحة
 * @returns طفرة الإصلاح
 */
export function useRepairCommissionPeriod(scope: PlanScope, memory: PlanAttemptMemory) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['commission-period-repair', ...scope],
    retry: false,
    gcTime: 0,
    mutationFn: async ({
      employeeId,
      body,
    }: RepairCommissionPeriodVariables): Promise<CommissionPeriodRepair> => {
      const started = planGeneration(client, scope);
      const memoryKey = `${employeeId}:${body.period}`;
      const fingerprint = JSON.stringify(body);
      const saved = memory.current.get(memoryKey);
      const held =
        saved !== undefined && saved.fingerprint === fingerprint
          ? saved
          : { key: crypto.randomUUID(), fingerprint };
      memory.current.set(memoryKey, held);
      try {
        const result = await createCommissionPeriodRepair(scope, employeeId, held.key, body);
        if (planGeneration(client, scope) !== started) return result;
        memory.current.delete(memoryKey);
        prependVersion(client, scope, employeeId, result.version);
        void client.invalidateQueries({ queryKey: planBlockedCorrectionsKey(scope) });
        return result;
      } catch (error) {
        if (isPlanForbidden(error)) {
          memory.current.clear();
          await denyPlanAccess(client, scope);
        } else if (planGeneration(client, scope) === started && isPlanNotFound(error)) {
          memory.current.delete(memoryKey);
        }
        throw error;
      }
    },
  });
}
