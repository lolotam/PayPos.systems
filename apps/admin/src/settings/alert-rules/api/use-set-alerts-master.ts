'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAlertRulesRefusal } from '../model/alert-rules-failure';
import { alertRulesKey, setAlertsMaster } from './alert-rules-client';

export function useSetAlertsMaster(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const key = alertRulesKey(companyId, userId, businessId, null);
  return useMutation({
    retry: false,
    mutationFn: (enabled: boolean) => setAlertsMaster(companyId, businessId, enabled),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
      await client.invalidateQueries({
        queryKey: ['alert-rules', companyId, userId, businessId],
        predicate: (query) => query.queryKey[4] !== null,
      });
    },
    onError: (error) => {
      if (!isAlertRulesRefusal(error)) return;
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
