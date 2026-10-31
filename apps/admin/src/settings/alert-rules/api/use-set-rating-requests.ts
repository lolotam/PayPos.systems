'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAlertRulesRefusal } from '../model/alert-rules-failure';
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
    onError: (error) => {
      if (!isAlertRulesRefusal(error)) return;
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
