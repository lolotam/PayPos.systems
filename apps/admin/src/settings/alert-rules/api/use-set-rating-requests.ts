'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ratingSettingsKey, setRatingRequests } from './alert-rules-client';

export function useSetRatingRequests(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const key = ratingSettingsKey(companyId, userId, businessId);
  return useMutation({
    mutationKey: [...key, 'write'],
    retry: false,
    mutationFn: (enabled: boolean) => setRatingRequests(companyId, businessId, enabled),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
    },
    // الخطأ مش معناه إن الكتابة ما اتحفظتش: الـ PUT ممكن يتحفظ في السيرفر والرد يضيع،
    // فنعيد القراية عشان المفتاح يبان زي المخزّن.
    onError: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
