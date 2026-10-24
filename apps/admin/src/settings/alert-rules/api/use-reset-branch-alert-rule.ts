'use client';

import type { AlertKindCode, ResetBranchAlertRuleQuery } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alertRulesStatus, isAlertRulesRefusal } from '../model/alert-rules-failure';
import { alertRulesKey, alertRulesWriteKey, resetBranchAlertRule } from './alert-rules-client';

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
    mutationKey: alertRulesWriteKey(companyId, userId, businessId),
    retry: false,
    mutationFn: ({ kind, expected }: ResetInput) =>
      resetBranchAlertRule(companyId, businessId, branchId, kind, expected),
    onSuccess: async () => {
      // إعلان الرجوع للقاعدة الأم بيتم بعد قراءة ناجحة بس، وإلا تفضل القيم ورسالة القراءة ظاهرة.
      try {
        await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
      } catch {
        return;
      }
      onDone();
    },
    onError: async (error) => {
      if (!isAlertRulesRefusal(error) && alertRulesStatus(error) !== 409) return;
      try {
        await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
      } catch {
        return;
      }
      if (alertRulesStatus(error) === 409) onConflict();
    },
  });
}
