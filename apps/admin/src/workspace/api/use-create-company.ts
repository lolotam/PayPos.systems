'use client';

import type { CreateCompanyInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createCompany } from './create-company-client';

/** محاولة لسه نتيجتها مجهولة: المفتاح بيفضل محفوظ لحد ما نجاح أو رفض قاطع بيأكده. */
export type HeldAttempt = { key: string; fingerprint: string };

/** الردود اللي شكلها رفض بس الجواب فيها مش قاطع: الطلب الأول بمفتاحه لسه ممكن يكون شغال أو متقبل. */
const UNCERTAIN_STATUSES = new Set([408, 409, 429]);

/**
 * الجواب القاطع هو النجاح أو رفض 4xx غير معلّق: السيرفر جاوب جواب نهائي إن مفيش شركة اتأنشأت
 * فالمفتاح بيتشرح. 408 و409 و429 مش قاطعين — 409 بيجي وما زال الطلب الأول بمفتاحه شغالًا على
 * السيرفر (IDEMPOTENCY_KEY_IN_PROGRESS)، والاتنين التانيين ممكن يكون الطلب اتقبل فعلًا —
 * فزي فشل الشبكة والـ 5xx المفتاح بيفضل محفوظ للإعادة عشان الإعادة ما تعملش شركة تانية.
 */
function decided(refusal: unknown): boolean {
  const status = (refusal as { status?: unknown }).status;
  return (
    typeof status === 'number' && status >= 400 && status < 500 && !UNCERTAIN_STATUSES.has(status)
  );
}

/**
 * بيحفظ مفتاح المحاولة الجاري: نفس القيم بعد فشل مجهول بتعيد نفس المفتاح، والجواب القاطع
 * أو تغيير القيم بيشرحه، وعلى النجاح قراءة مساحات العمل بتتعمل invalidation عشان
 * مزوّد مساحة العمل يختار الشركة الجديدة ويفتح لوحتها من غير إعادة تحميل للصفحة.
 */
export function useCreateCompany() {
  const client = useQueryClient();
  const [held] = useState(() => ({ current: null as HeldAttempt | null }));
  return useMutation({
    mutationKey: ['companies', 'create'],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: CreateCompanyInput) => {
      const fingerprint = JSON.stringify(input);
      const key =
        held.current?.fingerprint === fingerprint ? held.current.key : crypto.randomUUID();
      held.current = { key, fingerprint };
      try {
        const created = await createCompany(key, input);
        held.current = null;
        await client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
        return created;
      } catch (error) {
        if (decided(error)) held.current = null;
        throw error;
      }
    },
  });
}
