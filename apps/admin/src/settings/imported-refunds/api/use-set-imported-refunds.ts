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
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
    },
    // فشل الكتابة بيرجّع القيمة المخزنة للشاشة: الإلغاء بيخلي الـ GET ييجي تاني من الخادم.
    onError: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
