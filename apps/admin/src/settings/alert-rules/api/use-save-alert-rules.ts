'use client';

import type { SetAlertRulesInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alertRulesStatus, isAlertRulesRefusal } from '../model/alert-rules-failure';
import {
  alertRulesBusinessKey,
  alertRulesKey,
  alertRulesKeyBranch,
  saveAlertRules,
} from './alert-rules-client';

export function useSaveAlertRules(
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
) {
  const client = useQueryClient();
  const businessKey = alertRulesBusinessKey(companyId, userId, businessId);
  const key = alertRulesKey(companyId, userId, businessId, branchId);
  return useMutation({
    retry: false,
    mutationFn: (body: SetAlertRulesInput) => saveAlertRules(companyId, businessId, branchId, body),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
      await client.invalidateQueries({
        queryKey: businessKey,
        predicate: (query) => alertRulesKeyBranch(query.queryKey) !== branchId,
      });
    },
    onError: async (error) => {
      if (!isAlertRulesRefusal(error) && alertRulesStatus(error) !== 409) return;
      await client.invalidateQueries({ queryKey: key });
    },
  });
}
