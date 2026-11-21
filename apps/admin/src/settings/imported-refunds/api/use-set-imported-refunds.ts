'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { importedRefundsKey, setImportedRefunds } from './imported-refunds-client';

export function useSetImportedRefunds(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const key = importedRefundsKey(companyId, userId, businessId);
  return useMutation({
    mutationKey: [...key, 'write'],
    retry: false,
    mutationFn: (enabled: boolean) =>
      setImportedRefunds(companyId, businessId, { imported_refunds_enabled: enabled }),
    // الـ GET المحمي هو المرجع الوحيد للكاش: أي تسوية (نجاح أو فشل) بتعيد القراءة من الخادم ولا تخزن
    // رد الكتابة، فما فيش رد متأخر من تفويض قديم يرجّع المفتاح بعد ما قراية أحدث ترفض (403).
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
