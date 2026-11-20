'use client';

import type {
  CommissionServiceOverride,
  CreateCommissionServiceOverrideInput,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type RefObject } from 'react';
import { createServiceOverride } from './commission-overrides-client';
import {
  denyPlanAccess,
  isPlanForbidden,
  isPlanNotFound,
  planGeneration,
  planOverrideHistoryKey,
  planOverrideServicesKey,
  type PlanScope,
} from './plan-access';

/** محاولة حفظ لسه نتيجتها مجهولة: المفتاح بيفضل محفوظ لحد ما نجاح بيأكده. */
export type HeldOverrideAttempt = { key: string; fingerprint: string };
/** ذاكرة المحاولات لكل موظفة وخدمة — بتعيش في الصفحة فما بتضيعش بتبديل الخدمة. */
export type OverrideAttemptMemory = RefObject<Map<string, HeldOverrideAttempt>>;

/** طلب الحفظ: الخدمة اللي بيتحفظ عليها التجاوز والجسم المرسول. */
export type OverrideSaveRequest = { serviceId: string; body: CreateCommissionServiceOverrideInput };

/** ذاكرة محاولات الحفظ اللي بتعيش مع الصفحة: بتنضف بس بتغير الهوية لأن المسار بيعمل remount. */
export function useOverrideAttemptMemory(): OverrideAttemptMemory {
  const [attempts] = useState(() => ({ current: new Map<string, HeldOverrideAttempt>() }));
  return attempts;
}

/**
 * بيحفظ تجاوز جديد لخدمة: نفس الجسم لنفس الخدمة بيستعمل مفتاح المحاولة المحفوظ لحد ما
 * نجاح بيأكده (الرد المفقود ممكن يكون اتسجّل على السيرفر)، والجسم المختلف بياخد مفتاح جديد،
 * و403 بيقفل النطاق، و404 بيشيل قيد الخدمة بس، ورد بعد تغيّر الجيل بيتاهمل بلا أي أثر.
 * بعد النجاح تاريخ الخدمة بيتقرا من أول صفحة، والجدول بيتجلب تاني من غير ما الصفحات
 * المحمّلة تختفي.
 */
export function useSaveCommissionOverride(
  scope: PlanScope,
  employeeId: string,
  memory: OverrideAttemptMemory,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['commission-override-save', ...scope, employeeId],
    retry: false,
    gcTime: 0,
    mutationFn: async (request: OverrideSaveRequest): Promise<CommissionServiceOverride> => {
      const started = planGeneration(client, scope);
      const fingerprint = JSON.stringify(request.body);
      const key = `${employeeId}:${request.serviceId}`;
      const saved = memory.current.get(key);
      const held =
        saved !== undefined && saved.fingerprint === fingerprint
          ? saved
          : { key: crypto.randomUUID(), fingerprint };
      memory.current.set(key, held);
      try {
        const row = await createServiceOverride(scope, employeeId, held.key, request.body);
        if (planGeneration(client, scope) !== started) return row;
        if (memory.current.get(key) === held) memory.current.delete(key);
        await client.resetQueries({
          queryKey: planOverrideHistoryKey(scope, employeeId, request.serviceId),
        });
        await client.invalidateQueries({
          queryKey: planOverrideServicesKey(scope, employeeId),
        });
        return row;
      } catch (error) {
        if (planGeneration(client, scope) !== started) throw error;
        if (isPlanForbidden(error)) {
          memory.current.clear();
          await denyPlanAccess(client, scope);
        } else if (isPlanNotFound(error) && memory.current.get(key) === held) {
          memory.current.delete(key);
        }
        throw error;
      }
    },
  });
}
