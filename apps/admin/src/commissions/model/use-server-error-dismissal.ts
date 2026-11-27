'use client';

import { useEffect, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * سلوك نماذج الخطة المشترك مع رسالة السيرفر: أي تعديل من المدير بيخفيها فوراً والتمام بيرجّع أخطاء كل
 * البلوكات، والتمام عند التركيب بيعرض أخطاء المسودة الابتدائية ويقفل الحفظ من أول لحظة.
 *
 * @param form نموذج react-hook-form بمقرره
 * @param serverError آخر رفض من السيرفر
 * @returns هل الرسالة مخفية، ودالة بتخفيها لرفض السيرفر الحالي
 */
export function useServerErrorDismissal<TDraft extends FieldValues, TBody>(
  form: UseFormReturn<TDraft, unknown, TBody>,
  serverError: unknown,
): { dismissed: boolean; dismiss(): void } {
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);
  useEffect(() => {
    const subscription = form.watch((_values, { type }) => {
      if (type === 'change') {
        setDismissedFor(serverError);
        // التحقق عند التغيير بيحدّث خطأ الحقل الملموس بس، والتمام هنا بيرجّع أخطاء كل البلوكات.
        void form.trigger();
      }
    });
    return () => subscription.unsubscribe();
  }, [form, serverError]);
  useEffect(() => {
    // mode: 'onChange' ما بيتحققش عند التركيب، فالتمام هنا هو اللي بيبيّن أخطاء المسودة من أول لحظة.
    void form.trigger();
  }, [form]);
  return { dismissed: dismissedFor === serverError, dismiss: () => setDismissedFor(serverError) };
}
