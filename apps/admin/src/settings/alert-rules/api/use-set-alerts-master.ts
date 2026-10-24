'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAlertRulesRefusal } from '../model/alert-rules-failure';
import {
  alertRulesBusinessKey,
  alertRulesKey,
  alertRulesKeyBranch,
  alertRulesWriteKey,
  setAlertsMaster,
} from './alert-rules-client';

export function useSetAlertsMaster(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const businessKey = alertRulesBusinessKey(companyId, userId, businessId);
  const key = alertRulesKey(companyId, userId, businessId, null);
  return useMutation({
    mutationKey: alertRulesWriteKey(companyId, userId, businessId),
    retry: false,
    mutationFn: (enabled: boolean) => setAlertsMaster(companyId, businessId, enabled),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
      await client.invalidateQueries({
        queryKey: businessKey,
        predicate: (query) => alertRulesKeyBranch(query.queryKey) !== null,
      });
    },
    onError: (error) => {
      if (!isAlertRulesRefusal(error)) return;
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
