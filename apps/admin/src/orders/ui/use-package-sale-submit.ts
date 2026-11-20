'use client';
import { useRef, type FormEvent } from 'react';
import type { useSellPackage } from '../api/use-sell-package';

/**
 * بيمسك إرسال واحد بس في نفس الوقت، وبيمنع الإرسال الجديد طول ما عرض الباقة
 * المختار لسه مش متأكد، عشان الطلب القديم ما يتبعتش والسيرفر يرفضه بعد ما البعت.
 * الـ `quoteStale` لازم ييجي من الفورم مطفي وقت استرجاع البيع الأصلي، لأن الاسترجاع بيبعت
 * الطلب المحفوظ ومش بيقرأ عرض الباقة؛ الـ hook نفسه بيوقف على `quoteStale` قبل أي إرسال.
 */
export function usePackageSaleSubmit({
  mutation,
  pending,
  quoteStale,
  clearFailure,
  recordSaleRequestId,
  submit,
}: {
  mutation: ReturnType<typeof useSellPackage>;
  pending: boolean;
  quoteStale: boolean;
  clearFailure: () => void;
  recordSaleRequestId: (saleRequestId: string) => void;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const latch = useRef(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      latch.current ||
      pending ||
      mutation.restoring ||
      mutation.verificationRequired ||
      quoteStale
    )
      return;
    clearFailure();
    latch.current = true;
    const request = mutation.recoveryRequired
      ? mutation.mutateAsync(undefined).then(recordSaleRequestId, () => undefined)
      : submit(event);
    void request.finally(() => {
      latch.current = false;
    });
  };
  return { onSubmit };
}
