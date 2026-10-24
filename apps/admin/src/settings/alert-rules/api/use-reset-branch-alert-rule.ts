'use client';

import type { AlertKindCode, ResetBranchAlertRuleQuery } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alertRulesStatus, isAlertRulesRefusal } from '../model/alert-rules-failure';
import { alertRulesKey, resetBranchAlertRule } from './alert-rules-client';

type ResetInput = { kind: AlertKindCode; expected: ResetBranchAlertRuleQuery };

export function useResetBranchAlertRule(
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  onDone: () => void,
  onConflict: () => void,
) {
  const client = useQueryClient();
  const key = alertRulesKey(companyId, userId, businessId, branchId);
  return useMutation({
    retry: false,
    mutationFn: ({ kind, expected }: ResetInput) =>
      resetBranchAlertRule(companyId, businessId, branchId, kind, expected),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
      onDone();
    },
    onError: async (error) => {
      if (!isAlertRulesRefusal(error) && alertRulesStatus(error) !== 409) return;
      await client.invalidateQueries({ queryKey: key });
      if (alertRulesStatus(error) === 409) onConflict();
    },
  });
}
