'use client';

import type { SetAlertRulesInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alertRulesStatus, isAlertRulesRefusal } from '../model/alert-rules-failure';
import {
  alertRulesBusinessKey,
  alertRulesKey,
  alertRulesKeyBranch,
  alertRulesWriteKey,
  saveAlertRules,
} from './alert-rules-client';

export function useSaveAlertRules(
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
  onConflict: () => void,
) {
  const client = useQueryClient();
  const businessKey = alertRulesBusinessKey(companyId, userId, businessId);
  const key = alertRulesKey(companyId, userId, businessId, branchId);
  return useMutation({
    mutationKey: alertRulesWriteKey(companyId, userId, businessId),
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
      // فشل إعادة القراءة مش دليل على نسخة جديدة، فالمسودة ورسالة التعارض بتفضل من غير استبدال.
      try {
        await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
      } catch {
        return;
      }
      if (alertRulesStatus(error) === 409) onConflict();
    },
  });
}
